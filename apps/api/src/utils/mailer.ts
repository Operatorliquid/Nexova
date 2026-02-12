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
  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    user,
    pass,
    from,
    secure,
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
    await tx.sendMail({
      from: cfg.from,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    });
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown mail error';
    return { sent: false, error: message };
  }
};

