/**
 * Error Handling Plugin for Fastify
 */
import { FastifyPluginAsync, FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { AuthError, WorkspaceError, logger } from '@nexova/core';
import { ZodError } from 'zod';

interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}

const errorPluginCallback: FastifyPluginAsync = async (fastify) => {
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const requestId = request.id;

    // Log the error
    logger.error(
      {
        requestId,
        error: error.message,
        stack: error.stack,
        code: error.code,
        statusCode: error.statusCode,
      },
      'Request error'
    );

    // Handle known error types
    if (error instanceof AuthError) {
      return reply.code(getAuthErrorStatusCode(error.code)).send({
        error: error.code,
        message: error.message,
      } as ErrorResponse);
    }

    if (error instanceof WorkspaceError) {
      return reply.code(getWorkspaceErrorStatusCode(error.code)).send({
        error: error.code,
        message: error.message,
      } as ErrorResponse);
    }

    // Handle Zod validation errors (many routes use zod.parse directly)
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'La solicitud tiene datos inválidos',
        details: error.flatten(),
      } as ErrorResponse);
    }

    // Handle validation errors
    if (error.validation) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'La solicitud tiene datos inválidos',
        details: error.validation,
      } as ErrorResponse);
    }

    // Handle Prisma errors
    if (error.code?.startsWith('P')) {
      return reply.code(getPrismaErrorStatusCode(error.code)).send({
        error: 'DATABASE_ERROR',
        message: getPrismaErrorMessage(error.code),
      } as ErrorResponse);
    }

    // Handle rate limit errors
    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Demasiadas solicitudes. Intentá nuevamente más tarde',
      } as ErrorResponse);
    }

    // Default error response
    const statusCode = error.statusCode || 500;
    const isServerError = statusCode >= 500;

    return reply.code(statusCode).send({
      error: isServerError ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
      message: isServerError
        ? 'Ocurrió un error inesperado'
        : error.message,
    } as ErrorResponse);
  });

  // Not found handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'NOT_FOUND',
      message: `Ruta ${request.method} ${request.url} no encontrada`,
    } as ErrorResponse);
  });
};

function getAuthErrorStatusCode(code: string): number {
  switch (code) {
    case 'INVALID_CREDENTIALS':
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
    case 'TOKEN_REVOKED':
      return 401;
    case 'ACCOUNT_LOCKED':
    case 'ACCOUNT_SUSPENDED':
      return 403;
    case 'EMAIL_EXISTS':
    case 'WEAK_PASSWORD':
      return 400;
    default:
      return 400;
  }
}

function getWorkspaceErrorStatusCode(code: string): number {
  switch (code) {
    case 'SLUG_EXISTS':
    case 'ALREADY_MEMBER':
      return 400;
    case 'NOT_FOUND':
      return 404;
    default:
      return 400;
  }
}

function getPrismaErrorStatusCode(code: string): number {
  switch (code) {
    case 'P2002': // Unique constraint violation
      return 409;
    case 'P2025': // Record not found
      return 404;
    default:
      return 500;
  }
}

function getPrismaErrorMessage(code: string): string {
  switch (code) {
    case 'P2002':
      return 'Ya existe un registro con ese valor';
    case 'P2025':
      return 'Registro no encontrado';
    default:
      return 'Falló la operación en la base de datos';
  }
}

export const errorPlugin = fp(errorPluginCallback, {
  name: 'error',
});
