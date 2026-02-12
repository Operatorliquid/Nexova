import nodemailer from 'nodemailer';

type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const getMailConfig = () => {
  const host = process.env.SMTP_HOST;
  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;
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

let transporter: nodemailer.Transporter | null = null;

const getTransporter = () => {
  if (transporter) return transporter;
  const cfg = getMailConfig();
  if (!cfg.host || !cfg.user || !cfg.pass || !cfg.from) return null;

  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    connectionTimeout: cfg.connectionTimeout,
    greetingTimeout: cfg.greetingTimeout,
    socketTimeout: cfg.socketTimeout,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });
  return transporter;
};

export const isMailerConfigured = (): boolean => {
  const cfg = getMailConfig();
  return Boolean(cfg.host && cfg.user && cfg.pass && cfg.from);
};

export const sendMail = async (
  payload: MailPayload
): Promise<{ sent: boolean; error?: string }> => {
  const cfg = getMailConfig();
  const tx = getTransporter();
  if (!tx || !cfg.from) {
    return { sent: false, error: 'Mailer not configured' };
  }

  try {
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
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown mail error';
    return { sent: false, error: message };
  }
};
