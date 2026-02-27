/**
 * Workspace Routes
 */
import { randomBytes, scryptSync } from 'crypto';

import { type Prisma } from '@prisma/client';
import { type FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { WorkspaceService, type UpdateWorkspaceInput } from '@nexova/core';
import { EvolutionAdminClient, EvolutionError } from '@nexova/integrations';

import { getWorkspacePlanContext } from '../../utils/commerce-plan.js';

const createWorkspaceSchema = z.object({
  name: z.string().min(2).max(255),
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
});

const updateWorkspaceSchema = z.object({
  name: z.string().min(2).max(255).optional(),
  phone: z.string().max(20).optional(),
  settings: z.record(z.unknown()).optional(),
});

const inviteMemberSchema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid(),
});

function assertWorkspaceAccess(
  request: { workspaceId?: string; user?: { isSuperAdmin?: boolean } },
  reply: { code: (statusCode: number) => { send: (payload: unknown) => void } },
  targetWorkspaceId: string
): boolean {
  if (request.user?.isSuperAdmin) {
    return true;
  }

  if (!request.workspaceId) {
    reply.code(400).send({
      error: 'MISSING_WORKSPACE',
      message: 'X-Workspace-Id header required',
    });
    return false;
  }

  if (request.workspaceId !== targetWorkspaceId) {
    reply.code(403).send({
      error: 'FORBIDDEN',
      message: 'Workspace mismatch',
    });
    return false;
  }

  return true;
}

function hashOwnerAgentPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function toPhoneDigits(value: string): string {
  return (value || '').trim().replace(/\D/g, '');
}

const WHATSAPP_CONTACT_REGEX = /^\+?\d{8,15}$/;
const RECEIPT_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

function randomNumericString(length: number): string {
  const bytes = randomBytes(Math.max(8, length));
  let out = '';
  for (let i = 0; out.length < length; i++) {
    out += String(bytes[i % bytes.length] % 10);
  }
  return out.slice(0, length);
}

const EVOLUTION_CONNECT_LOCK_TTL_MS = Number.parseInt(
  process.env.EVOLUTION_CONNECT_LOCK_TTL_MS || '90000',
  10
);
const evolutionConnectLocks = new Map<string, number>();

function tryAcquireEvolutionConnectLock(workspaceId: string): boolean {
  const key = `ws:evolution:connect:${workspaceId}`;
  const now = Date.now();
  const lockedUntil = evolutionConnectLocks.get(key) || 0;
  if (lockedUntil > now) return false;
  evolutionConnectLocks.set(key, now + EVOLUTION_CONNECT_LOCK_TTL_MS);
  return true;
}

function releaseEvolutionConnectLock(workspaceId: string): void {
  evolutionConnectLocks.delete(`ws:evolution:connect:${workspaceId}`);
}

function resolvePublicBaseUrlFromEnv(): string | null {
  const candidates = [
    process.env.API_BASE_URL,
    process.env.PUBLIC_BASE_URL,
    process.env.PUBLIC_API_URL,
    process.env.API_PUBLIC_URL,
    process.env.NGROK_URL,
    process.env.BASE_URL,
    process.env.API_URL,
  ];
  for (const value of candidates) {
    const trimmed = (value || '').trim().replace(/\/$/, '');
    if (trimmed) return trimmed;
  }
  return null;
}

function resolveEvolutionConfigFromEnv(): { baseUrl: string; apiKey: string } | null {
  let baseUrl = (process.env.EVOLUTION_BASE_URL || '').trim().replace(/\/+$/, '');
  // Allow setting EVOLUTION_BASE_URL without protocol (common on Railway).
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    baseUrl = `https://${baseUrl}`;
  }
  const apiKey = (process.env.EVOLUTION_API_KEY || '').trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

function evolutionErrorToMessage(err: unknown): { statusCode: number; message: string } {
  if (err instanceof EvolutionError) {
    const body = (err.responseBody || '').trim();
    const snippet = body ? body.slice(0, 800) : '';
    return {
      statusCode: 502,
      message: `Evolution API error (${err.statusCode})${snippet ? `: ${snippet}` : ''}`,
    };
  }

  if (err instanceof Error) {
    return { statusCode: 502, message: err.message || 'Error conectando con Evolution' };
  }

  return { statusCode: 502, message: 'Error conectando con Evolution' };
}

function getEvolutionInstanceName(providerConfig: unknown): string {
  if (!providerConfig || typeof providerConfig !== 'object') return '';
  const cfg = providerConfig as Record<string, unknown>;
  const value = cfg.instanceName ?? cfg.instance ?? cfg.name;
  return typeof value === 'string' ? value.trim() : '';
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readMaybeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRecordString(record: UnknownRecord | null, key: string): string {
  return readMaybeString(record?.[key]);
}

function normalizeEvolutionInstances(instances: unknown): UnknownRecord[] {
  if (Array.isArray(instances)) {
    return instances.filter(isRecord);
  }
  if (isRecord(instances)) {
    const response = instances.response;
    if (Array.isArray(response)) return response.filter(isRecord);
    const message = instances.message;
    if (Array.isArray(message)) return message.filter(isRecord);
  }
  return [];
}

function matchesEvolutionInstance(item: UnknownRecord, instanceName: string): boolean {
  const nestedInstance = isRecord(item.instance) ? item.instance : null;
  return (
    readRecordString(item, 'name') === instanceName
    || readRecordString(item, 'instanceName') === instanceName
    || readRecordString(nestedInstance, 'name') === instanceName
    || readRecordString(nestedInstance, 'instanceName') === instanceName
  );
}

function extractConnectCount(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const count = value.count;
  return typeof count === 'number' ? count : null;
}

function extractEvolutionQrFromConnectResponse(value: unknown): {
  qrCode: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
} {
  const pickQr = (input: unknown): string => {
    const obj = isRecord(input) ? input : null;
    if (!obj) return '';
    const direct =
      readRecordString(obj, 'code')
      || readRecordString(obj, 'qrcode')
      || readRecordString(obj, 'qrCode')
      || readRecordString(obj, 'qr')
      || readRecordString(obj, 'base64');
    if (direct) return direct;

    const qrobj = isRecord(obj.qrcode) ? obj.qrcode : null;
    if (qrobj) {
      const nested =
        readRecordString(qrobj, 'base64')
        || readRecordString(qrobj, 'qrcode')
        || readRecordString(qrobj, 'qrCode')
        || readRecordString(qrobj, 'qr')
        || readRecordString(qrobj, 'code');
      if (nested) return nested;
    }

    const qrObj = isRecord(obj.qr) ? obj.qr : null;
    if (qrObj) {
      const nested =
        readRecordString(qrObj, 'base64')
        || readRecordString(qrObj, 'qrcode')
        || readRecordString(qrObj, 'qrCode')
        || readRecordString(qrObj, 'qr')
        || readRecordString(qrObj, 'code');
      if (nested) return nested;
    }

    return '';
  };

  const root = isRecord(value) ? value : null;
  const dataObj = isRecord(root?.data) ? root.data : null;
  const qrValue = pickQr(value);
  const pairingValue =
    readRecordString(root, 'pairingCode')
    || readRecordString(root, 'pairing_code')
    || readRecordString(dataObj, 'pairingCode')
    || readRecordString(dataObj, 'pairing_code');

  const isDataUrl = !!qrValue && /^data:image\//i.test(qrValue);
  const looksLikeBase64Image =
    !!qrValue
    && !isDataUrl
    && qrValue.length > 100
    && /^[A-Za-z0-9+/=]+$/.test(qrValue)
    && (
      qrValue.startsWith('iVBOR') // png
      || qrValue.startsWith('/9j/') // jpeg
      || qrValue.startsWith('R0lGOD') // gif
      || qrValue.startsWith('UklGR') // webp
    );

  const qrDataUrl =
    qrValue && isDataUrl
      ? qrValue
      : looksLikeBase64Image
        ? `data:image/png;base64,${qrValue}`
        : null;

  const qrCode = qrValue && !isDataUrl && !looksLikeBase64Image ? qrValue : null;
  const pairingCode = pairingValue || null;

  return { qrCode, qrDataUrl, pairingCode };
}

function normalizeOwnerAgentNumberForSettings(raw: unknown, timezone: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return '';

  let digits = toPhoneDigits(trimmed);
  if (!digits) return trimmed;

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  const tz = typeof timezone === 'string' ? timezone.trim() : '';
  const isArgentina = tz.startsWith('America/Argentina/');

  if (isArgentina) {
    if (digits.startsWith('54')) {
      if (!digits.startsWith('549') && digits.length === 12) {
        digits = `549${digits.slice(2)}`;
      }
      return `+${digits}`;
    }

    digits = digits.replace(/^0+/, '');
    if (digits.length === 10) {
      return `+549${digits}`;
    }

    if (digits.length >= 11) {
      return `+${digits}`;
    }
  }

  if (trimmed.startsWith('+') && digits.length >= 11) {
    return `+${digits}`;
  }

  if (digits.length >= 11) {
    return `+${digits}`;
  }

  return trimmed;
}

function normalizeWhatsappContactForSettings(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;

  const trimmed = raw.trim();
  if (!trimmed) return '';

  const hasLeadingPlus = trimmed.startsWith('+');
  const digits = toPhoneDigits(trimmed);
  if (!digits) return trimmed;

  const canonical = `${hasLeadingPlus ? '+' : ''}${digits}`;
  return canonical;
}

function isValidWhatsappContactForSettings(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  if (!trimmed) return true;
  return WHATSAPP_CONTACT_REGEX.test(trimmed);
}

export const workspaceRoutes: FastifyPluginAsync = async (fastify) => {
  const workspaceService = new WorkspaceService(fastify.prisma);

  // Get user's workspaces (protected)
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate], config: { allowMissingWorkspace: true } },
    async (request, reply) => {
      const workspaces = await workspaceService.getUserWorkspaces(request.user!.sub);
      return reply.send({ workspaces });
    }
  );

  // Get pending invitations for current user (protected)
  fastify.get(
    '/available',
    { preHandler: [fastify.authenticate], config: { allowMissingWorkspace: true } },
    async (request, reply) => {
      const invitations = await fastify.prisma.membership.findMany({
        where: {
          userId: request.user!.sub,
          status: { in: ['invited', 'INVITED'] },
          OR: [{ inviteExpiresAt: null }, { inviteExpiresAt: { gt: new Date() } }],
          workspace: { is: { status: 'active' } },
        },
        include: {
          workspace: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          role: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      const workspaces = invitations.map((invite) => ({
        id: invite.workspace.id,
        name: invite.workspace.name,
        slug: invite.workspace.slug,
        role: invite.role,
        inviteExpiresAt: invite.inviteExpiresAt,
      }));

      return reply.send({ workspaces });
    }
  );

  // Create workspace (protected)
  fastify.post(
    '/',
    { preHandler: [fastify.authenticate], config: { allowMissingWorkspace: true } },
    async (request, reply) => {
      const body = createWorkspaceSchema.parse(request.body);

      const workspace = await workspaceService.create({
        name: body.name,
        slug: body.slug,
        ownerId: request.user!.sub,
      });

      return reply.code(201).send({ workspace });
    }
  );

  // Get workspace by ID (protected)
  fastify.get(
    '/:id',
    { preHandler: [fastify.requirePermission('settings:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      const workspace = await workspaceService.getById(id);

      if (!workspace) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Workspace not found',
        });
      }

      return reply.send({ workspace });
    }
  );

  // Update workspace (protected, requires settings:update)
  fastify.patch(
    '/:id',
    { preHandler: [fastify.requirePermission('settings:update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;
      const body = updateWorkspaceSchema.parse(request.body);

      const workspace = await workspaceService.update(id, {
        name: body.name,
        phone: body.phone,
        settings: body.settings as UpdateWorkspaceInput['settings'],
      });

      return reply.send({ workspace });
    }
  );

  // Delete workspace (protected, requires owner role)
  fastify.delete(
    '/:id',
    { preHandler: [fastify.requirePermission('*')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      await workspaceService.delete(id);

      return reply.send({ success: true });
    }
  );

  // Get workspace members (protected)
  fastify.get(
    '/:id/members',
    { preHandler: [fastify.requirePermission('members:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      const members = await workspaceService.getMembers(id);

      return reply.send({ members });
    }
  );

  // Invite member (protected)
  fastify.post(
    '/:id/members/invite',
    { preHandler: [fastify.requirePermission('members:create')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;
      const body = inviteMemberSchema.parse(request.body);

      const membership = await workspaceService.inviteMember(
        id,
        body.email,
        body.roleId,
        request.user!.sub
      );

      return reply.code(201).send({ membership });
    }
  );

  // Remove member (protected)
  fastify.delete(
    '/:id/members/:userId',
    { preHandler: [fastify.requirePermission('members:delete')] },
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      await workspaceService.removeMember(id, userId);

      return reply.send({ success: true });
    }
  );

  // Get workspace roles (protected - only requires auth for own workspace)
  fastify.get(
    '/:id/roles',
    { preHandler: [fastify.requirePermission('members:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      const roles = await fastify.prisma.role.findMany({
        where: { workspaceId: id },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          description: true,
          permissions: true,
          isSystem: true,
        },
      });

      return reply.send({ roles });
    }
  );

  // Join workspace (protected)
  fastify.post(
    '/:id/join',
    { preHandler: [fastify.authenticate], config: { allowMissingWorkspace: true } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.sub;

      const invitedMembership = await fastify.prisma.membership.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: id } },
        include: {
          role: true,
          workspace: true,
        },
      });

      if (!invitedMembership) {
        return reply.code(403).send({
          error: 'INVITE_REQUIRED',
          message: 'You need a valid invitation to join this workspace',
        });
      }

      const membershipStatus = (invitedMembership.status || '').toLowerCase();
      if (membershipStatus === 'active') {
        return reply.code(400).send({
          error: 'ALREADY_MEMBER',
          message: 'Already a member of this workspace',
        });
      }

      if (membershipStatus !== 'invited') {
        return reply.code(400).send({
          error: 'INVALID_MEMBERSHIP_STATUS',
          message: 'Only invited memberships can be accepted',
        });
      }

      if (
        invitedMembership.inviteExpiresAt
        && invitedMembership.inviteExpiresAt.getTime() <= Date.now()
      ) {
        return reply.code(410).send({
          error: 'INVITE_EXPIRED',
          message: 'Invitation expired',
        });
      }

      const membership = await fastify.prisma.membership.update({
        where: { id: invitedMembership.id },
        data: {
          status: 'ACTIVE',
          joinedAt: new Date(),
          inviteToken: null,
          inviteExpiresAt: null,
        },
        include: {
          role: true,
          workspace: true,
        },
      });

      return reply.send({ membership });
    }
  );

  // Update own role in workspace (disabled to prevent privilege escalation)
  fastify.patch(
    '/:id/members/me/role',
    { preHandler: [fastify.requirePermission('members:update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      return reply.code(403).send({
        error: 'SELF_ROLE_CHANGE_DISABLED',
        message: 'Changing your own role is disabled for security reasons',
      });
    }
  );

  // Get available WhatsApp numbers for workspace to claim (protected)
  fastify.get(
    '/:id/whatsapp-numbers/available',
    { preHandler: [fastify.requirePermission('connections:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      // Get workspace with settings
      const workspace = await fastify.prisma.workspace.findUnique({
        where: { id },
        select: { settings: true },
      });

      if (!workspace) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Workspace not found',
        });
      }

      // Get business type from workspace settings
      const settings = (workspace.settings as Record<string, unknown>) || {};
      const businessType = (settings.businessType as string) || 'commerce';

      // Get available numbers for this business type (not assigned to any workspace)
      const numbers = await fastify.prisma.whatsAppNumber.findMany({
        where: {
          provider: 'infobip',
          businessType,
          status: 'available',
          workspaceId: null,
          isActive: true,
        },
        select: {
          id: true,
          phoneNumber: true,
          displayName: true,
        },
      });

      return reply.send({ numbers });
    }
  );

  // Get workspace's connected WhatsApp number (protected)
  fastify.get(
    '/:id/whatsapp-numbers',
    { preHandler: [fastify.requirePermission('connections:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      // Get WhatsApp number assigned to this workspace
      const number = await fastify.prisma.whatsAppNumber.findFirst({
        where: {
          workspaceId: id,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phoneNumber: true,
          displayName: true,
          provider: true,
          status: true,
          healthStatus: true,
          isActive: true,
        },
      });

      return reply.send({ number });
    }
  );

  // Claim a WhatsApp number for workspace (protected - owner only)
  fastify.post(
    '/:id/whatsapp-numbers/:numberId/claim',
    { preHandler: [fastify.requirePermission('connections:create')] },
    async (request, reply) => {
      const { id, numberId } = request.params as { id: string; numberId: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      // Check if workspace already has a number
      const existingNumber = await fastify.prisma.whatsAppNumber.findFirst({
        where: { workspaceId: id },
      });

      if (existingNumber) {
        return reply.code(400).send({
          error: 'ALREADY_CONNECTED',
          message: 'Workspace already has a WhatsApp number connected. Disconnect first.',
        });
      }

      // Get workspace settings to check business type
      const workspace = await fastify.prisma.workspace.findUnique({
        where: { id },
        select: { settings: true },
      });

      const settings = (workspace?.settings as Record<string, unknown>) || {};
      const businessType = (settings.businessType as string) || 'commerce';

      // Verify number is available and matches business type
      const number = await fastify.prisma.whatsAppNumber.findFirst({
        where: {
          id: numberId,
          provider: 'infobip',
          businessType,
          status: 'available',
          workspaceId: null,
          isActive: true,
        },
      });

      if (!number) {
        return reply.code(404).send({
          error: 'NOT_AVAILABLE',
          message: 'Number is not available or does not match your business type',
        });
      }

      // Claim the number
      const claimedResult = await fastify.prisma.whatsAppNumber.updateMany({
        where: { id: numberId, workspaceId: null, status: 'available' },
        data: {
          workspaceId: id,
          status: 'assigned',
        },
      });
      if (claimedResult.count === 0) {
        return reply.code(404).send({
          error: 'NOT_AVAILABLE',
          message: 'Number is not available or does not match your business type',
        });
      }

      const claimed = await fastify.prisma.whatsAppNumber.findFirst({
        where: { id: numberId, workspaceId: id },
        select: {
          id: true,
          phoneNumber: true,
          displayName: true,
          status: true,
        },
      });
      if (!claimed) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'Number not found after assignment',
        });
      }

      return reply.send({ number: claimed });
    }
  );

  // Release/disconnect a WhatsApp number (protected - owner only)
  fastify.post(
    '/:id/whatsapp-numbers/release',
    { preHandler: [fastify.requirePermission('connections:delete')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      // Find and release the number
      const number = await fastify.prisma.whatsAppNumber.findFirst({
        where: { workspaceId: id, provider: 'infobip' },
      });

      if (!number) {
        return reply.code(404).send({
          error: 'NOT_FOUND',
          message: 'No WhatsApp number connected to this workspace',
        });
      }

      await fastify.prisma.whatsAppNumber.updateMany({
        where: { id: number.id, workspaceId: id },
        data: {
          workspaceId: null,
          status: 'available',
        },
      });

      return reply.send({ success: true });
    }
  );

  // Get available WhatsApp providers for workspace (protected)
  fastify.get(
    '/:id/whatsapp/providers',
    { preHandler: [fastify.requirePermission('connections:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      const evolutionCfg = resolveEvolutionConfigFromEnv();

      return reply.send({
        defaultProvider: 'infobip',
        providers: [
          {
            id: 'infobip',
            label: 'Infobip (Nexova)',
            connectMode: 'claim',
            enabled: true,
          },
          {
            id: 'evolution',
            label: 'Evolution (QR)',
            connectMode: 'qr',
            enabled: !!evolutionCfg,
          },
        ],
      });
    }
  );

  // Start Evolution QR connection flow (protected)
  fastify.post(
    '/:id/whatsapp/evolution/connect',
    { preHandler: [fastify.requirePermission('connections:create')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      if (!tryAcquireEvolutionConnectLock(id)) {
        return reply.code(409).send({
          error: 'EVOLUTION_CONNECT_IN_PROGRESS',
          message: 'Ya hay una conexión de WhatsApp en proceso. Esperá unos segundos e intentá nuevamente.',
        });
      }

      try {

      const evolutionCfg = resolveEvolutionConfigFromEnv();
      if (!evolutionCfg) {
        return reply.code(400).send({
          error: 'EVOLUTION_NOT_CONFIGURED',
          message: 'Evolution no está configurado (EVOLUTION_BASE_URL / EVOLUTION_API_KEY).',
        });
      }

      const publicBase = resolvePublicBaseUrlFromEnv();
      if (!publicBase) {
        return reply.code(400).send({
          error: 'PUBLIC_URL_MISSING',
          message: 'Falta configurar API_PUBLIC_URL (o API_BASE_URL / PUBLIC_BASE_URL) para generar el webhook público.',
        });
      }

      // Ensure workspace does not already have an active WhatsApp connection
      const existingActive = await fastify.prisma.whatsAppNumber.findFirst({
        where: { workspaceId: id, isActive: true },
      });
      if (existingActive) {
        return reply.code(400).send({
          error: 'ALREADY_CONNECTED',
          message: 'Este negocio ya tiene un WhatsApp conectado. Desconectalo primero.',
        });
      }

      // Resolve business type
      const workspace = await fastify.prisma.workspace.findUnique({
        where: { id },
        select: { settings: true },
      });
      const settings = (workspace?.settings as Record<string, unknown>) || {};
      const businessType = (settings.businessType as string) || 'commerce';

      // Create or reuse a connecting record
      let number = await fastify.prisma.whatsAppNumber.findFirst({
        where: { workspaceId: id, provider: 'evolution' },
      });

      const instanceName = number ? getEvolutionInstanceName(number.providerConfig) : `ws-${id}`;
      const webhookSecret = number?.webhookSecret || randomBytes(18).toString('hex');
      const webhookUrl = `${publicBase}/api/whatsapp/evolution/${webhookSecret}`;

      if (!number) {
        // Placeholder phone until we can resolve the connected owner number.
        const placeholder = `+000${randomNumericString(12)}`;

        number = await fastify.prisma.whatsAppNumber.create({
          data: {
            workspaceId: id,
            businessType,
            phoneNumber: placeholder,
            displayName: 'Conectando...',
            provider: 'evolution',
            apiUrl: evolutionCfg.baseUrl,
            webhookSecret,
            providerConfig: {
              instanceName,
              integration: 'WHATSAPP-BAILEYS',
              webhookUrl,
            } as Prisma.InputJsonValue,
            status: 'assigned',
            isActive: false,
            healthStatus: 'connecting',
          },
        });
      } else {
        const currentCfg =
          number.providerConfig && typeof number.providerConfig === 'object'
            ? (number.providerConfig as Record<string, unknown>)
            : {};
        // Clear previous QR/pairing artifacts to avoid showing stale QR codes.
        // New QR will arrive either in the connect response or via webhook `QRCODE_UPDATED`.
        const cfgRest = { ...currentCfg };
        delete cfgRest.qrCode;
        delete cfgRest.qrDataUrl;
        delete cfgRest.pairingCode;
        delete cfgRest.qrUpdatedAt;
        // Keep record fresh if env/baseUrl changed
        await fastify.prisma.whatsAppNumber.updateMany({
          where: { id: number.id, workspaceId: id },
          data: {
            apiUrl: evolutionCfg.baseUrl,
            webhookSecret,
            providerConfig: {
              ...cfgRest,
              instanceName,
              integration: 'WHATSAPP-BAILEYS',
              webhookUrl,
            } as Prisma.InputJsonValue,
            status: 'assigned',
            isActive: false,
            healthStatus: 'connecting',
          },
        });
      }

      const admin = new EvolutionAdminClient({
        apiKey: evolutionCfg.apiKey,
        baseUrl: evolutionCfg.baseUrl,
      });

      const hasInstance = (instances: unknown): boolean => {
        const list = normalizeEvolutionInstances(instances);
        return list.some((item) => matchesEvolutionInstance(item, instanceName));
      };

      const safeFetchInstances = async (query?: { instanceName?: string; instanceId?: string }): Promise<unknown> => {
        try {
          return await admin.fetchInstances(query);
        } catch (err) {
          // Evolution returns 404 when filtering by instanceName and it doesn't exist.
          if (err instanceof EvolutionError && err.statusCode === 404) {
            return [];
          }
          throw err;
        }
      };

      // Ensure instance exists (idempotent reconnect). Evolution can return 404 for "fetchInstances?instanceName"
      // when the instance doesn't exist; that should be treated as "not found" (create it).
      const instances = await safeFetchInstances({ instanceName });
      if (!hasInstance(instances)) {
        try {
          await admin.createInstance({
            instanceName,
            integration: 'WHATSAPP-BAILEYS',
            qrcode: true,
            groupsIgnore: true,
            webhook: {
              url: webhookUrl,
              byEvents: true,
              base64: false,
              events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
              headers: {
                authorization: '',
                'Content-Type': 'application/json',
              },
            },
          });
        } catch (err) {
          // If create failed but the instance exists (race / already created), continue.
          fastify.log.warn(err, 'Evolution createInstance failed (verifying existence)');
          const after = await safeFetchInstances({ instanceName });
          if (!hasInstance(after)) {
            const { statusCode, message } = evolutionErrorToMessage(err);
            return reply.code(statusCode).send({
              error: 'EVOLUTION_CREATE_INSTANCE_FAILED',
              message,
            });
          }
        }
      }

      // Ensure webhook configured (required for inbound messages)
      try {
        await admin.setWebhook(instanceName, {
          enabled: true,
          url: webhookUrl,
          byEvents: true,
          base64: false,
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        });
      } catch (err) {
        const { statusCode, message } = evolutionErrorToMessage(err);
        return reply.code(statusCode).send({
          error: 'EVOLUTION_WEBHOOK_FAILED',
          message,
        });
      }

      // Get QR code content
      let connect: Awaited<ReturnType<typeof admin.connectInstance>>;
      try {
        connect = await admin.connectInstance(instanceName);
      } catch (err) {
        const { statusCode, message } = evolutionErrorToMessage(err);
        return reply.code(statusCode).send({
          error: 'EVOLUTION_CONNECT_FAILED',
          message,
          });
      }

      // Some Evolution builds generate the QR asynchronously; retry a few times so the UI doesn't look "stuck".
      let extracted = extractEvolutionQrFromConnectResponse(connect);
      for (let attempt = 0; attempt < 6 && !extracted.qrCode && !extracted.qrDataUrl && !extracted.pairingCode; attempt++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          connect = await admin.connectInstance(instanceName);
          extracted = extractEvolutionQrFromConnectResponse(connect);
        } catch (err) {
          fastify.log.warn(err, 'Evolution connectInstance retry failed (continuing)');
        }
      }

      const { qrCode, qrDataUrl, pairingCode } = extracted;

      // Persist latest QR/pairing code so the dashboard can poll /status (and to survive refresh).
      try {
        const current = await fastify.prisma.whatsAppNumber.findUnique({
          where: { id: number.id },
          select: { providerConfig: true },
        });
        const currentCfg =
          current?.providerConfig && typeof current.providerConfig === 'object'
            ? (current.providerConfig as Record<string, unknown>)
            : {};
        const nextCfg: Record<string, unknown> = {
          ...currentCfg,
          ...(qrCode ? { qrCode } : {}),
          ...(qrDataUrl ? { qrDataUrl } : {}),
          ...(pairingCode ? { pairingCode } : {}),
          lastConnectAt: new Date().toISOString(),
          lastConnectCount: extractConnectCount(connect),
          ...(qrCode || qrDataUrl || pairingCode ? { qrUpdatedAt: new Date().toISOString() } : {}),
        };

        await fastify.prisma.whatsAppNumber.updateMany({
          where: { id: number.id, workspaceId: id },
          data: { providerConfig: nextCfg as Prisma.InputJsonValue },
        });
      } catch (err) {
        fastify.log.warn(err, 'Failed to persist Evolution QR to providerConfig (continuing)');
      }

      return reply.send({
        provider: 'evolution',
        instanceName,
        pairingCode,
        qrCode,
        qrDataUrl,
        count: extractConnectCount(connect),
      });
      } finally {
        releaseEvolutionConnectLock(id);
      }
    }
  );

  // Evolution connection status (protected)
  fastify.get(
    '/:id/whatsapp/evolution/status',
    { preHandler: [fastify.requirePermission('connections:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      const evolutionCfg = resolveEvolutionConfigFromEnv();
      if (!evolutionCfg) {
        return reply.code(400).send({
          error: 'EVOLUTION_NOT_CONFIGURED',
          message: 'Evolution no está configurado (EVOLUTION_BASE_URL / EVOLUTION_API_KEY).',
        });
      }

      const number = await fastify.prisma.whatsAppNumber.findFirst({
        where: { workspaceId: id, provider: 'evolution' },
      });

      if (!number) {
        return reply.send({ provider: 'evolution', state: 'missing', connected: false });
      }

      const instanceName = getEvolutionInstanceName(number.providerConfig);
      if (!instanceName) {
        return reply.send({ provider: 'evolution', state: 'missing_instance', connected: false });
      }

      const admin = new EvolutionAdminClient({
        apiKey: evolutionCfg.apiKey,
        baseUrl: evolutionCfg.baseUrl,
      });

      let state = 'unknown';
      try {
        const res = await admin.getConnectionState(instanceName);
        state = (res?.instance?.state || 'unknown');
      } catch (err) {
        fastify.log.warn(err, 'Evolution getConnectionState failed');
      }

      const connected = String(state).toLowerCase() === 'open';

      if (connected) {
        // Fetch owner number and mark active
        try {
          const instances = await admin.fetchInstances({ instanceName });
          const list = normalizeEvolutionInstances(instances);
          const row = list.find((item) => matchesEvolutionInstance(item, instanceName)) || list[0] || null;
          const rowInstance = row && isRecord(row.instance) ? row.instance : null;
          const rowProfile = rowInstance && isRecord(rowInstance.profile) ? rowInstance.profile : null;
          const ownerJidRaw =
            (rowInstance ? rowInstance.owner : null)
            || (rowInstance ? rowInstance.ownerJid : null)
            || (row ? row.owner : null)
            || (rowProfile ? rowProfile.owner : null)
            || null;
          const ownerJid = typeof ownerJidRaw === 'string' ? ownerJidRaw : null;
          const ownerDigits =
            typeof ownerJid === 'string'
              ? ownerJid.split('@')[0]?.replace(/\D/g, '') || ''
              : '';
          const ownerPhone = ownerDigits ? `+${ownerDigits}` : null;

          if (ownerPhone && ownerPhone !== number.phoneNumber) {
            await fastify.prisma.whatsAppNumber.updateMany({
              where: { id: number.id, workspaceId: id },
              data: {
                phoneNumber: ownerPhone,
                displayName: ownerPhone,
              },
            });
          }

          await fastify.prisma.whatsAppNumber.updateMany({
            where: { id: number.id, workspaceId: id },
            data: {
              isActive: true,
              healthStatus: 'healthy',
              healthCheckedAt: new Date(),
              status: 'assigned',
              lastError: null,
              lastErrorAt: null,
            },
          });
        } catch (err) {
          fastify.log.warn(err, 'Evolution fetchInstances/activate failed');
        }
      } else {
        await fastify.prisma.whatsAppNumber.updateMany({
          where: { id: number.id, workspaceId: id },
          data: {
            isActive: false,
            healthStatus: state || 'unknown',
            healthCheckedAt: new Date(),
          },
        });
      }

      const refreshed = await fastify.prisma.whatsAppNumber.findUnique({
        where: { id: number.id },
        select: { id: true, phoneNumber: true, displayName: true, provider: true, isActive: true, healthStatus: true, providerConfig: true },
      });

      const refreshedCfg =
        refreshed?.providerConfig && typeof refreshed.providerConfig === 'object'
          ? (refreshed.providerConfig as Record<string, unknown>)
          : {};
      const qrCode = typeof refreshedCfg.qrCode === 'string' ? refreshedCfg.qrCode.trim() : null;
      const qrDataUrl = typeof refreshedCfg.qrDataUrl === 'string' ? refreshedCfg.qrDataUrl.trim() : null;
      const pairingCode = typeof refreshedCfg.pairingCode === 'string' ? refreshedCfg.pairingCode.trim() : null;

      // If we're still connecting and we don't have a QR yet, try to fetch it from /instance/connect
      // (Evolution may not emit QRCODE_UPDATED via webhook depending on build/config).
      let effectiveQrCode = qrCode;
      let effectiveQrDataUrl = qrDataUrl;
      let effectivePairingCode = pairingCode;

      const stateLower = String(state || '').toLowerCase();
      if (!connected && stateLower === 'connecting' && !effectiveQrCode && !effectiveQrDataUrl) {
        const lastConnectAt = typeof refreshedCfg.lastConnectAt === 'string' ? refreshedCfg.lastConnectAt : '';
        const lastConnectMs = lastConnectAt ? new Date(lastConnectAt).getTime() : 0;
        const nowMs = Date.now();
        const shouldRetry = !lastConnectMs || Number.isNaN(lastConnectMs) || nowMs - lastConnectMs > 5_000;

        if (shouldRetry) {
          try {
            const connectRes = await admin.connectInstance(instanceName);
            const extracted = extractEvolutionQrFromConnectResponse(connectRes);
            if (extracted.qrCode) effectiveQrCode = extracted.qrCode;
            if (extracted.qrDataUrl) effectiveQrDataUrl = extracted.qrDataUrl;
            if (extracted.pairingCode) effectivePairingCode = extracted.pairingCode;

            if (extracted.qrCode || extracted.qrDataUrl || extracted.pairingCode) {
              await fastify.prisma.whatsAppNumber.updateMany({
                where: { id: number.id, workspaceId: id },
                data: {
                  providerConfig: {
                    ...refreshedCfg,
                    ...(effectiveQrCode ? { qrCode: effectiveQrCode } : {}),
                    ...(effectiveQrDataUrl ? { qrDataUrl: effectiveQrDataUrl } : {}),
                    ...(effectivePairingCode ? { pairingCode: effectivePairingCode } : {}),
                    lastConnectAt: new Date().toISOString(),
                    qrUpdatedAt: new Date().toISOString(),
                  } as Prisma.InputJsonValue,
                },
              });
            } else {
              await fastify.prisma.whatsAppNumber.updateMany({
                where: { id: number.id, workspaceId: id },
                data: {
                  providerConfig: {
                    ...refreshedCfg,
                    lastConnectAt: new Date().toISOString(),
                  } as Prisma.InputJsonValue,
                },
              });
            }
          } catch (err) {
            fastify.log.warn(err, 'Evolution connectInstance (status retry) failed');
          }
        }
      }

      const numberInfo = refreshed
        ? {
            id: refreshed.id,
            phoneNumber: refreshed.phoneNumber,
            displayName: refreshed.displayName,
            provider: refreshed.provider,
            isActive: refreshed.isActive,
            healthStatus: refreshed.healthStatus,
          }
        : null;

      return reply.send({
        provider: 'evolution',
        state,
        connected,
        ...(effectiveQrCode ? { qrCode: effectiveQrCode } : {}),
        ...(effectiveQrDataUrl ? { qrDataUrl: effectiveQrDataUrl } : {}),
        ...(effectivePairingCode ? { pairingCode: effectivePairingCode } : {}),
        number: numberInfo,
      });
    }
  );

  // Disconnect Evolution instance (protected)
  fastify.post(
    '/:id/whatsapp/evolution/disconnect',
    { preHandler: [fastify.requirePermission('connections:delete')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!assertWorkspaceAccess(request, reply, id)) return;

      const evolutionCfg = resolveEvolutionConfigFromEnv();
      if (!evolutionCfg) {
        return reply.code(400).send({
          error: 'EVOLUTION_NOT_CONFIGURED',
          message: 'Evolution no está configurado (EVOLUTION_BASE_URL / EVOLUTION_API_KEY).',
        });
      }

      const number = await fastify.prisma.whatsAppNumber.findFirst({
        where: { workspaceId: id, provider: 'evolution' },
      });

      if (!number) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'No hay WhatsApp Evolution conectado.' });
      }

      const instanceName = getEvolutionInstanceName(number.providerConfig);
      const admin = new EvolutionAdminClient({
        apiKey: evolutionCfg.apiKey,
        baseUrl: evolutionCfg.baseUrl,
      });

      if (instanceName) {
        try {
          await admin.logoutInstance(instanceName);
        } catch (err) {
          fastify.log.warn(err, 'Evolution logout failed (continuing)');
        }
        try {
          await admin.deleteInstance(instanceName);
        } catch (err) {
          fastify.log.warn(err, 'Evolution deleteInstance failed (continuing)');
        }
      }

      // Remove record to keep workspace clean
      await fastify.prisma.whatsAppNumber.deleteMany({
        where: { id: number.id, workspaceId: id },
      });

      return reply.send({ success: true });
    }
  );

  // Update workspace settings (protected - requires settings:update)
  fastify.patch(
    '/:id/settings',
    { preHandler: [fastify.requirePermission('settings:update')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.sub;
      if (!assertWorkspaceAccess(request, reply, id)) return;

      // Verify user membership and load role context
      const membership = await fastify.prisma.membership.findUnique({
        where: { userId_workspaceId: { userId, workspaceId: id } },
        include: { role: true },
      });

      if (!membership) {
        return reply.code(403).send({
          error: 'FORBIDDEN',
          message: 'Not a member of this workspace',
        });
      }

      // Settings updates are restricted by RBAC (`settings:update`).

      const planContext = await getWorkspacePlanContext(
        fastify.prisma,
        id,
        membership.role.name
      );

      const body = z
        .object({
          businessType: z.enum(['commerce', 'bookings']).optional(),
          tools: z.array(z.string()).optional(),
          currency: z.string().optional(),
          timezone: z.string().optional(),
          language: z.string().optional(),
          businessName: z.string().max(120).optional(),
          // Commerce profile fields
          companyLogo: z.string().url().optional().nullable(),
	          whatsappContact: z
	            .string()
	            .trim()
	            .max(20)
	            .regex(/^\+?[0-9()\-\s]{8,20}$/, 'WhatsApp de contacto invalido')
	            .optional(),
	          ownerAgentEnabled: z.boolean().optional(),
	          ownerAgentNumber: z.string().max(20).optional(),
	          ownerAgentPin: z
	            .string()
	            .trim()
	            .min(4)
	            .max(12)
	            .regex(/^[0-9]+$/, 'PIN must be numeric')
	            .optional()
	            .nullable(),
	          paymentAlias: z.string().max(100).optional(),
	          paymentCbu: z.string().max(100).optional(),
	          businessAddress: z.string().max(500).optional(),
	          vatConditionId: z.string().max(50).optional().nullable(),
          monotributoCategory: z.string().max(2).optional(),
          monotributoActivity: z.enum(['services', 'goods']).optional(),
          paymentMethodsEnabled: z
            .object({
              mpLink: z.boolean().optional(),
              transfer: z.boolean().optional(),
              cash: z.boolean().optional(),
            })
            .optional(),
          notificationPreferences: z
            .object({
              orders: z.boolean().optional(),
              handoffs: z.boolean().optional(),
              stock: z.boolean().optional(),
              payments: z.boolean().optional(),
              customers: z.boolean().optional(),
            })
            .optional(),
          lowStockThreshold: z.number().int().min(0).max(1_000_000).optional(),
          workingDays: z.array(z.enum(['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'])).optional(),
          continuousHours: z.boolean().optional(),
          workingHoursStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          workingHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          morningShiftStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          morningShiftEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          afternoonShiftStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          afternoonShiftEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          assistantNotes: z.string().max(2000).optional(),
          receiptBranding: z
            .object({
              title: z.string().trim().max(60).optional(),
              footerText: z.string().trim().max(220).optional(),
              primaryColor: z.string().trim().regex(RECEIPT_COLOR_REGEX, 'Color inválido').optional(),
              tableHeaderColor: z.string().trim().regex(RECEIPT_COLOR_REGEX, 'Color inválido').optional(),
              logoMode: z.enum(['business', 'custom', 'none']).optional(),
              customLogoUrl: z
                .string()
                .trim()
                .max(2_000_000)
                .refine(
                  (value) => value.length === 0 || /^https?:\/\//i.test(value) || /^data:image\//i.test(value),
                  'Logo personalizado inválido'
                )
                .optional(),
              showBusinessAddress: z.boolean().optional(),
            })
            .optional()
            .nullable(),
          availabilityStatus: z.enum(['available', 'unavailable', 'vacation']).optional(),
	        })
	        .parse(request.body);

      const updatesPaymentSettings =
        'paymentAlias' in body
        || 'paymentCbu' in body
        || 'paymentMethodsEnabled' in body
        || 'vatConditionId' in body
        || 'monotributoCategory' in body
        || 'monotributoActivity' in body;
      if (updatesPaymentSettings) {
        const paymentsGuard = fastify.requirePermission('payments:update');
        await paymentsGuard(request, reply);
        if (reply.sent) return;
      }

      const updatesOwnerAgentSettings =
        'ownerAgentEnabled' in body
        || 'ownerAgentNumber' in body
        || 'ownerAgentPin' in body;
      if (updatesOwnerAgentSettings) {
        const ownerAgentGuard = fastify.requirePermission('sessions:takeover');
        await ownerAgentGuard(request, reply);
        if (reply.sent) return;
      }

	      // Get current settings and merge
      const workspace = await fastify.prisma.workspace.findUnique({
        where: { id },
        select: { settings: true },
      });

	      const currentSettings = (workspace?.settings as Record<string, unknown>) || {};
	      const { ownerAgentPin, ...rest } = body;
	      const newSettings: Record<string, unknown> = { ...currentSettings, ...rest };

      if (body.receiptBranding === null) {
        delete newSettings.receiptBranding;
      } else if (isRecord(body.receiptBranding)) {
        const existingReceiptBranding = isRecord(currentSettings.receiptBranding)
          ? currentSettings.receiptBranding
          : {};
        const mergedReceiptBranding: Record<string, unknown> = {
          ...existingReceiptBranding,
          ...body.receiptBranding,
        };

        const normalizeStringSetting = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
        const normalizeColorSetting = (value: unknown): string => {
          const normalized = normalizeStringSetting(value);
          return RECEIPT_COLOR_REGEX.test(normalized) ? normalized.toUpperCase() : '';
        };

        const normalizedTitle = normalizeStringSetting(mergedReceiptBranding.title);
        if (normalizedTitle) mergedReceiptBranding.title = normalizedTitle;
        else delete mergedReceiptBranding.title;

        const normalizedFooter = normalizeStringSetting(mergedReceiptBranding.footerText);
        if (normalizedFooter) mergedReceiptBranding.footerText = normalizedFooter;
        else delete mergedReceiptBranding.footerText;

        const normalizedPrimaryColor = normalizeColorSetting(mergedReceiptBranding.primaryColor);
        if (normalizedPrimaryColor) mergedReceiptBranding.primaryColor = normalizedPrimaryColor;
        else delete mergedReceiptBranding.primaryColor;

        const normalizedTableHeaderColor = normalizeColorSetting(mergedReceiptBranding.tableHeaderColor);
        if (normalizedTableHeaderColor) mergedReceiptBranding.tableHeaderColor = normalizedTableHeaderColor;
        else delete mergedReceiptBranding.tableHeaderColor;

        const normalizedLogoMode = normalizeStringSetting(mergedReceiptBranding.logoMode);
        if (normalizedLogoMode === 'business' || normalizedLogoMode === 'custom' || normalizedLogoMode === 'none') {
          mergedReceiptBranding.logoMode = normalizedLogoMode;
        } else {
          delete mergedReceiptBranding.logoMode;
        }

        const normalizedCustomLogo = normalizeStringSetting(mergedReceiptBranding.customLogoUrl);
        if (normalizedCustomLogo) mergedReceiptBranding.customLogoUrl = normalizedCustomLogo;
        else delete mergedReceiptBranding.customLogoUrl;

        if (mergedReceiptBranding.logoMode !== 'custom') {
          delete mergedReceiptBranding.customLogoUrl;
        }

        if (typeof mergedReceiptBranding.showBusinessAddress !== 'boolean') {
          delete mergedReceiptBranding.showBusinessAddress;
        }

        if (Object.keys(mergedReceiptBranding).length > 0) {
          newSettings.receiptBranding = mergedReceiptBranding;
        } else {
          delete newSettings.receiptBranding;
        }
      }

      const hasLowStockThresholdUpdate = typeof body.lowStockThreshold === 'number';
      const lowStockThresholdToApply = hasLowStockThresholdUpdate
        ? body.lowStockThreshold
        : null;

      if (!planContext.capabilities.showOwnerWhatsappAgentSettings) {
        delete newSettings.ownerAgentEnabled;
        delete newSettings.ownerAgentNumber;
        delete newSettings.ownerAgentPinHash;
      }
      if (!planContext.capabilities.showBusinessInvoicingSettings) {
        delete newSettings.vatConditionId;
        delete newSettings.monotributoCategory;
        delete newSettings.monotributoActivity;
      }
      if (!planContext.capabilities.showReceiptBrandingSettings) {
        delete newSettings.receiptBranding;
      }
      if (!planContext.capabilities.showSettingsNotifications) {
        delete newSettings.notificationPreferences;
      }
      if (!planContext.capabilities.showMercadoPagoIntegration) {
        const paymentMethodsEnabled =
          (newSettings.paymentMethodsEnabled as Record<string, unknown> | undefined) || {};
        newSettings.paymentMethodsEnabled = {
          ...paymentMethodsEnabled,
          mpLink: false,
        };
      }

	      if (planContext.capabilities.showOwnerWhatsappAgentSettings && ownerAgentPin === null) {
	        delete newSettings.ownerAgentPinHash;
	      } else if (
          planContext.capabilities.showOwnerWhatsappAgentSettings &&
          typeof ownerAgentPin === 'string' &&
          ownerAgentPin.trim()
        ) {
	        newSettings.ownerAgentPinHash = hashOwnerAgentPin(ownerAgentPin.trim());
	      }

        if (typeof newSettings.ownerAgentNumber === 'string') {
          const normalized = normalizeOwnerAgentNumberForSettings(
            newSettings.ownerAgentNumber,
            newSettings.timezone
          );
          if (typeof normalized === 'string') {
            newSettings.ownerAgentNumber = normalized;
          }
        }

        if (typeof newSettings.whatsappContact === 'string') {
          const normalized = normalizeWhatsappContactForSettings(newSettings.whatsappContact);
          if (typeof normalized === 'string') {
            newSettings.whatsappContact = normalized;
          }
          if (!isValidWhatsappContactForSettings(newSettings.whatsappContact)) {
            return reply.code(400).send({
              error: 'INVALID_WHATSAPP_CONTACT',
              message: 'WhatsApp de contacto invalido. Usa 8 a 15 digitos (opcional + al inicio).',
            });
          }
        }

      const updated = await fastify.prisma.$transaction(async (tx) => {
        if (hasLowStockThresholdUpdate && lowStockThresholdToApply !== null) {
          const productIds = await tx.product.findMany({
            where: { workspaceId: id },
            select: { id: true },
          });
          if (productIds.length > 0) {
            await tx.stockItem.updateMany({
              where: {
                productId: { in: productIds.map((product) => product.id) },
              },
              data: {
                lowThreshold: lowStockThresholdToApply,
              },
            });
          }
        }

        return tx.workspace.update({
          where: { id },
          data: { settings: newSettings as Prisma.InputJsonValue },
          select: {
            id: true,
            name: true,
            slug: true,
            settings: true,
          },
        });
      });

      return reply.send({ workspace: updated });
    }
  );

};
