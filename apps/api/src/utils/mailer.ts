import dns from 'node:dns';
import nodemailer from 'nodemailer';

type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

type MailProvider = 'smtp' | 'resend';

type MailRuntimeConfig = {
  host?: string;
  port: number;
  user?: string;
  pass?: string;
  from?: string;
  secure: boolean;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  sendTimeout: number;
};

type MailTransportConfig = {
  label: string;
  host: string;
  port: number;
  secure: boolean;
  requireTLS?: boolean;
  tlsServername?: string;
  user: string;
  pass: string;
  from: string;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  sendTimeout: number;
};

const getMailConfig = (): MailRuntimeConfig => {
  const host = process.env.SMTP_HOST;
  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || process.env.SMTP_FROM;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
  const connectionTimeout = Number.parseInt(
    process.env.SMTP_CONNECTION_TIMEOUT_MS || '10000',
    10
  );
  const greetingTimeout = Number.parseInt(
    process.env.SMTP_GREETING_TIMEOUT_MS || '10000',
    10
  );
  const socketTimeout = Number.parseInt(
    process.env.SMTP_SOCKET_TIMEOUT_MS || '15000',
    10
  );
  const sendTimeout = Number.parseInt(process.env.SMTP_SEND_TIMEOUT_MS || '15000', 10);

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    user,
    pass,
    from,
    secure,
    connectionTimeout: Number.isFinite(connectionTimeout) ? connectionTimeout : 10000,
    greetingTimeout: Number.isFinite(greetingTimeout) ? greetingTimeout : 10000,
    socketTimeout: Number.isFinite(socketTimeout) ? socketTimeout : 15000,
    sendTimeout: Number.isFinite(sendTimeout) ? sendTimeout : 15000,
  };
};

const getMailProvider = (): MailProvider => {
  const raw = String(process.env.MAIL_PROVIDER || 'smtp').toLowerCase().trim();
  if (raw === 'resend') return 'resend';
  return 'smtp';
};

let dnsConfigured = false;
const transporters = new Map<string, nodemailer.Transporter>();

const ensureDnsResultOrder = () => {
  if (dnsConfigured) return;
  dnsConfigured = true;

  const preferIpv4 = String(process.env.SMTP_PREFER_IPV4 ?? 'true').toLowerCase() !== 'false';
  if (!preferIpv4) return;

  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch {
    // Ignore if runtime does not support this option.
  }
};

const buildTransportConfigs = (cfg: MailRuntimeConfig): MailTransportConfig[] => {
  if (!cfg.host || !cfg.user || !cfg.pass || !cfg.from) return [];

  const list: MailTransportConfig[] = [
    {
      label: 'primary',
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      user: cfg.user,
      pass: cfg.pass,
      from: cfg.from,
      connectionTimeout: cfg.connectionTimeout,
      greetingTimeout: cfg.greetingTimeout,
      socketTimeout: cfg.socketTimeout,
      sendTimeout: cfg.sendTimeout,
    },
  ];

  const allowFallback = String(process.env.SMTP_ALLOW_FALLBACK ?? 'true').toLowerCase() !== 'false';
  if (!allowFallback) return list;

  // Hostinger SMTP can fail by environment/route depending on port.
  // Add automatic fallback between SSL:465 and STARTTLS:587.
  if (cfg.host === 'smtp.hostinger.com') {
    if (cfg.port === 465 && cfg.secure) {
      list.push({
        label: 'fallback-hostinger-587',
        host: cfg.host,
        port: 587,
        secure: false,
        requireTLS: true,
        tlsServername: 'smtp.hostinger.com',
        user: cfg.user,
        pass: cfg.pass,
        from: cfg.from,
        connectionTimeout: cfg.connectionTimeout,
        greetingTimeout: cfg.greetingTimeout,
        socketTimeout: cfg.socketTimeout,
        sendTimeout: cfg.sendTimeout,
      });
    } else if (cfg.port === 587 && !cfg.secure) {
      list.push({
        label: 'fallback-hostinger-465',
        host: cfg.host,
        port: 465,
        secure: true,
        tlsServername: 'smtp.hostinger.com',
        user: cfg.user,
        pass: cfg.pass,
        from: cfg.from,
        connectionTimeout: cfg.connectionTimeout,
        greetingTimeout: cfg.greetingTimeout,
        socketTimeout: cfg.socketTimeout,
        sendTimeout: cfg.sendTimeout,
      });
    }

    // Many Hostinger mailboxes are backed by Titan. Using Titan directly can bypass
    // networking edge cases (e.g., Cloudflare IP blocks from some cloud providers).
    list.push({
      label: 'fallback-titan-465',
      host: 'smtp.titan.email',
      port: 465,
      secure: true,
      tlsServername: 'smtp.titan.email',
      user: cfg.user,
      pass: cfg.pass,
      from: cfg.from,
      connectionTimeout: cfg.connectionTimeout,
      greetingTimeout: cfg.greetingTimeout,
      socketTimeout: cfg.socketTimeout,
      sendTimeout: cfg.sendTimeout,
    });

    list.push({
      label: 'fallback-titan-587',
      host: 'smtp.titan.email',
      port: 587,
      secure: false,
      requireTLS: true,
      tlsServername: 'smtp.titan.email',
      user: cfg.user,
      pass: cfg.pass,
      from: cfg.from,
      connectionTimeout: cfg.connectionTimeout,
      greetingTimeout: cfg.greetingTimeout,
      socketTimeout: cfg.socketTimeout,
      sendTimeout: cfg.sendTimeout,
    });
  }

  return list;
};

const transporterKey = (cfg: MailTransportConfig): string =>
  `${cfg.host}:${cfg.port}:${cfg.secure ? 'secure' : 'plain'}:${cfg.requireTLS ? 'reqtls' : 'noreqtls'}`;

const getTransporter = (cfg: MailTransportConfig): nodemailer.Transporter => {
  const key = transporterKey(cfg);
  const cached = transporters.get(key);
  if (cached) return cached;

  const created = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    requireTLS: cfg.requireTLS,
    connectionTimeout: cfg.connectionTimeout,
    greetingTimeout: cfg.greetingTimeout,
    socketTimeout: cfg.socketTimeout,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
    tls: cfg.tlsServername
      ? {
          servername: cfg.tlsServername,
        }
      : undefined,
  });

  transporters.set(key, created);
  return created;
};

const isRetryableMailError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('timeout') ||
    normalized.includes('enetunreach') ||
    normalized.includes('ehostunreach') ||
    normalized.includes('etimedout') ||
    normalized.includes('econnrefused') ||
    normalized.includes('socket hang up') ||
    normalized.includes('connection closed')
  );
};

const sendWithConfig = async (
  cfg: MailTransportConfig,
  payload: MailPayload
): Promise<void> => {
  const tx = getTransporter(cfg);
  await Promise.race([
    tx.sendMail({
      from: cfg.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('SMTP send timeout')), cfg.sendTimeout);
    }),
  ]);
};

export const isMailerConfigured = (): boolean => {
  const provider = getMailProvider();
  if (provider === 'resend') {
    const from = process.env.MAIL_FROM || process.env.SMTP_FROM;
    return Boolean(process.env.RESEND_API_KEY && from);
  }

  const cfg = getMailConfig();
  return Boolean(cfg.host && cfg.user && cfg.pass && cfg.from);
};

const readResendError = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as {
      message?: string;
      error?: string;
      details?: unknown;
    };
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    return JSON.stringify(data);
  } catch {
    try {
      return await response.text();
    } catch {
      return `HTTP ${response.status}`;
    }
  }
};

const sendMailViaResend = async (
  cfg: MailRuntimeConfig,
  payload: MailPayload
): Promise<{ sent: boolean; error?: string }> => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = cfg.from || process.env.MAIL_FROM || process.env.SMTP_FROM;
  if (!apiKey || !from) {
    return { sent: false, error: 'Resend not configured' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.sendTimeout);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        sent: false,
        error: `resend: ${await readResendError(response)}`,
      };
    }

    return { sent: true };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'resend: send timeout'
          : `resend: ${error.message}`
        : 'resend: unknown error';
    return { sent: false, error: message };
  } finally {
    clearTimeout(timeout);
  }
};

export const sendMail = async (
  payload: MailPayload
): Promise<{ sent: boolean; error?: string }> => {
  const provider = getMailProvider();
  const base = getMailConfig();

  if (provider === 'resend') {
    return sendMailViaResend(base, payload);
  }

  ensureDnsResultOrder();
  const configs = buildTransportConfigs(base);
  if (configs.length === 0) {
    return { sent: false, error: 'Mailer not configured' };
  }

  const errors: string[] = [];

  for (let index = 0; index < configs.length; index += 1) {
    const cfg = configs[index];
    try {
      await sendWithConfig(cfg, payload);
      return { sent: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown mail error';
      errors.push(`${cfg.label}: ${message}`);
      const isLast = index === configs.length - 1;
      if (isLast || !isRetryableMailError(message)) {
        return { sent: false, error: errors.join(' | ') };
      }
    }
  }

  return { sent: false, error: errors.join(' | ') || 'Unknown mail error' };
};
