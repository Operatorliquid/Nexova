/**
 * Conversations Routes
 * Handles inbox conversations and messages
 */
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { decrypt } from '@nexova/core';

function resolveWhatsAppApiKey(number: {
  apiKeyEnc?: string | null;
  apiKeyIv?: string | null;
}): string {
  if (!number.apiKeyEnc || !number.apiKeyIv) {
    return '';
  }
  return decrypt({ encrypted: number.apiKeyEnc, iv: number.apiKeyIv });
}

function resolveInfobipBaseUrl(apiUrl?: string | null): string {
  const cleaned = (apiUrl || '').trim().replace(/\/$/, '');
  const envUrl = (process.env.INFOBIP_BASE_URL || '').trim().replace(/\/$/, '');
  const defaultUrl = 'https://api.infobip.com';

  if (cleaned && cleaned.toLowerCase() !== defaultUrl) {
    return cleaned;
  }
  if (envUrl) {
    return envUrl;
  }
  return cleaned || defaultUrl;
}

export const conversationsRoutes: FastifyPluginAsync = async (fastify) => {
  // Get all conversations for workspace
  fastify.get(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const workspaceId = request.workspaceId;

      if (!workspaceId) {
        return reply.code(400).send({ error: 'No workspace selected' });
      }

      const sessions = await fastify.prisma.agentSession.findMany({
        where: {
          workspaceId,
          endedAt: null, // Only active sessions
        },
        include: {
          customer: {
            select: {
              id: true,
              phone: true,
              firstName: true,
              lastName: true,
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1, // Last message for preview
          },
        },
        orderBy: { lastActivityAt: 'desc' },
      });

      const conversations = sessions.map((session) => ({
        id: session.id,
        customerId: session.customerId,
        customerPhone: session.customer.phone,
        customerName: session.customer.firstName
          ? `${session.customer.firstName} ${session.customer.lastName || ''}`.trim()
          : session.customer.phone,
        channelType: session.channelType,
        agentActive: session.agentActive,
        currentState: session.currentState,
        lastMessage: session.messages[0]?.content || null,
        lastMessageRole: session.messages[0]?.role || null,
        lastActivityAt: session.lastActivityAt,
      }));

      reply.send({ conversations });
    }
  );

  // Get messages for a conversation
  fastify.get<{ Params: { sessionId: string } }>(
    '/:sessionId/messages',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sessionId } = request.params;
      const workspaceId = request.workspaceId;

      if (!workspaceId) {
        return reply.code(400).send({ error: 'No workspace selected' });
      }

      // Verify session belongs to workspace
      const session = await fastify.prisma.agentSession.findFirst({
        where: { id: sessionId, workspaceId },
        include: {
          customer: {
            select: {
              id: true,
              phone: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      if (!session) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }

      const messages = await fastify.prisma.agentMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          role: true,
          content: true,
          metadata: true,
          createdAt: true,
        },
      });

      reply.send({
        session: {
          id: session.id,
          customer: session.customer,
          agentActive: session.agentActive,
          currentState: session.currentState,
        },
        messages,
      });
    }
  );

  // Send a message (human takeover)
  fastify.post<{ Params: { sessionId: string }; Body: { content: string } }>(
    '/:sessionId/messages',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { content } = z.object({ content: z.string().min(1) }).parse(request.body);
      const workspaceId = request.workspaceId;

      if (!workspaceId) {
        return reply.code(400).send({ error: 'No workspace selected' });
      }

      // Verify session belongs to workspace
      const session = await fastify.prisma.agentSession.findFirst({
        where: { id: sessionId, workspaceId },
        include: {
          workspace: {
            include: {
              whatsappNumbers: {
                where: { isActive: true },
                take: 1,
              },
            },
          },
        },
      });

      if (!session) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }

      // Create the message
      const message = await fastify.prisma.agentMessage.create({
        data: {
          sessionId,
          role: 'assistant', // Human acting as assistant
          content,
          metadata: { sentByHuman: true, odiserId: request.user?.sub },
        },
      });

      // Update session - human took over
      await fastify.prisma.agentSession.updateMany({
        where: { id: sessionId, workspaceId },
        data: {
          agentActive: false,
          lastActivityAt: new Date(),
        },
      });

      // Send via WhatsApp if number is configured
      const whatsappNumber = session.workspace.whatsappNumbers[0];
      if (whatsappNumber && session.channelType === 'whatsapp') {
        try {
          const { InfobipClient } = await import('@nexova/integrations/whatsapp');
          const apiKey = resolveWhatsAppApiKey(whatsappNumber);
          if (!apiKey) {
            request.log.warn('WhatsApp API key not configured for workspace');
            return;
          }
          const client = new InfobipClient({
            apiKey,
            baseUrl: resolveInfobipBaseUrl(whatsappNumber.apiUrl),
            senderNumber: whatsappNumber.phoneNumber,
          });

          await client.sendText(session.channelId, content);
        } catch (error) {
          request.log.error(error, 'Failed to send WhatsApp message');
        }
      }

      reply.send({ message });
    }
  );

  // Toggle agent active status
  fastify.patch<{ Params: { sessionId: string }; Body: { agentActive: boolean } }>(
    '/:sessionId/agent',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sessionId } = request.params;
      const { agentActive } = z.object({ agentActive: z.boolean() }).parse(request.body);
      const workspaceId = request.workspaceId;

      if (!workspaceId) {
        return reply.code(400).send({ error: 'No workspace selected' });
      }

      const session = await fastify.prisma.agentSession.updateMany({
        where: { id: sessionId, workspaceId },
        data: { agentActive },
      });

      if (session.count === 0) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }

      reply.send({ success: true, agentActive });
    }
  );

  // Delete a conversation
  fastify.delete<{ Params: { sessionId: string } }>(
    '/:sessionId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sessionId } = request.params;
      const workspaceId = request.workspaceId;

      if (!workspaceId) {
        return reply.code(400).send({ error: 'No workspace selected' });
      }

      // Verify session belongs to workspace
      const session = await fastify.prisma.agentSession.findFirst({
        where: { id: sessionId, workspaceId },
      });

      if (!session) {
        return reply.code(404).send({ error: 'Conversation not found' });
      }

      // Delete messages first (foreign key constraint)
      await fastify.prisma.agentMessage.deleteMany({
        where: { sessionId },
      });

      // Delete the session
      await fastify.prisma.agentSession.deleteMany({
        where: { id: sessionId, workspaceId },
      });

      reply.send({ success: true });
    }
  );
};
