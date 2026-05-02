import { type FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { isMailerConfigured, sendMail } from '../../utils/mailer.js';

const DEMO_LEADS_FALLBACK_TO = 'josestratta4@gmail.com';

const demoLeadSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email(),
  whatsapp: z.string().trim().min(6).max(60),
  business: z.string().trim().min(1).max(120).optional(),
  source: z.string().trim().min(1).max(80).optional(),
});

const readLeadRecipients = (): string[] => {
  const raw = (process.env.DEMO_LEADS_TO || DEMO_LEADS_FALLBACK_TO).trim();
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const leadsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/demo', async (request, reply) => {
    const body = demoLeadSchema.parse(request.body ?? {});
    const recipients = readLeadRecipients();

    if (recipients.length === 0) {
      return reply.code(500).send({
        error: 'LEADS_RECIPIENTS_NOT_CONFIGURED',
        message: 'No hay destinatarios configurados para leads de demo.',
      });
    }

    const normalizedSource = body.source || 'demo-page';
    const receivedAt = new Date().toISOString();
    const displayName = body.name || '(sin nombre)';

    const subject = `[Nexova Demo] Nuevo lead: ${displayName}`;
    const text = [
      'Nuevo lead de demo (landing Nexova)',
      '',
      `Nombre: ${displayName}`,
      `Email: ${body.email}`,
      `WhatsApp: ${body.whatsapp}`,
      `Negocio: ${body.business || '(no informado)'}`,
      `Source: ${normalizedSource}`,
      `Fecha: ${receivedAt}`,
      `IP: ${request.ip}`,
      `User-Agent: ${request.headers['user-agent'] || '(no informado)'}`,
    ].join('\n');

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a">
        <h2 style="margin:0 0 14px;font-size:20px">Nuevo lead de demo</h2>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0">
          <tbody>
            <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;background:#f8fafc"><strong>Nombre</strong></td><td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(displayName)}</td></tr>
            <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;background:#f8fafc"><strong>Email</strong></td><td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(body.email)}</td></tr>
            <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;background:#f8fafc"><strong>WhatsApp</strong></td><td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(body.whatsapp)}</td></tr>
            <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;background:#f8fafc"><strong>Tipo de negocio</strong></td><td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(body.business || '(no informado)')}</td></tr>
            <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;background:#f8fafc"><strong>Source</strong></td><td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(normalizedSource)}</td></tr>
            <tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;background:#f8fafc"><strong>Fecha</strong></td><td style="padding:10px;border-bottom:1px solid #e2e8f0">${escapeHtml(receivedAt)}</td></tr>
            <tr><td style="padding:10px;background:#f8fafc"><strong>IP</strong></td><td style="padding:10px">${escapeHtml(request.ip)}</td></tr>
          </tbody>
        </table>
      </div>
    `;

    const mailResult = await sendMail({
      to: recipients.join(','),
      subject,
      text,
      html,
    });

    if (!mailResult.sent) {
      request.log.error(
        {
          recipients,
          source: normalizedSource,
          leadEmail: body.email,
          mailError: mailResult.error || 'unknown',
        },
        'Demo lead email send failed'
      );

      if (isMailerConfigured()) {
        return reply.code(500).send({
          error: 'MAIL_SEND_FAILED',
          message: 'No se pudo enviar el lead por email. Intentá nuevamente.',
        });
      }

      return reply.code(202).send({
        success: true,
        delivered: false,
        message: 'Lead recibido, pero el mailer no está configurado en este entorno.',
      });
    }

    return reply.code(201).send({
      success: true,
      delivered: true,
      sentTo: recipients,
    });
  });
};
