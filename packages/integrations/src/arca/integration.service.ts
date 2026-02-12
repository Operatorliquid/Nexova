import { PrismaClient, Prisma, type WorkspaceIntegration } from '@prisma/client';
import { encrypt, decrypt } from '@nexova/core';
import type {
  ArcaAccessTicket,
  ArcaConnectionInput,
  ArcaEnvironment,
  ArcaIntegrationStatus,
  ArcaInvoiceRequest,
  ArcaInvoiceResult,
  ArcaInvoiceLookup,
} from './types.js';
import { ArcaIntegrationError } from './types.js';
import { wsaaLogin, wsfeDummy, wsfeCompUltimoAutorizado, wsfeCaeSolicitar, wsfeCompConsultar, wsfeParamGetPtosVenta } from './arca.client.js';

const PROVIDER_NAME = 'arca';
const SERVICE_NAME = 'wsfe';
// WSAA may reject login attempts while a valid TA exists (coe.alreadyAuthenticated),
// so only refresh when the stored ticket is actually expired.
const TOKEN_REFRESH_BUFFER_MS = 0;

interface ArcaProviderData {
  cuit: string;
  environment: ArcaEnvironment;
  pointOfSale: number;
  service: string;
  certEnc?: string;
  certIv?: string;
  keyEnc?: string;
  keyIv?: string;
  csr?: string;
  csrGeneratedAt?: string;
  taEnc?: string;
  taIv?: string;
  taExpiresAt?: string;
  lastError?: string;
}

export class ArcaIntegrationService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  private async getIntegration(workspaceId: string): Promise<WorkspaceIntegration | null> {
    return this.prisma.workspaceIntegration.findFirst({
      where: { workspaceId, provider: PROVIDER_NAME },
    });
  }

  private parseProviderData(integration: WorkspaceIntegration | null): ArcaProviderData | null {
    if (!integration?.providerData) return null;
    if (typeof integration.providerData !== 'object') return null;
    return integration.providerData as unknown as ArcaProviderData;
  }

  async getStatus(workspaceId: string): Promise<ArcaIntegrationStatus> {
    const integration = await this.getIntegration(workspaceId);
    if (!integration) {
      return { connected: false, status: 'disconnected' };
    }

    const data = this.parseProviderData(integration);
    return {
      connected: integration.status === 'connected',
      status: integration.status,
      cuit: data?.cuit,
      environment: data?.environment,
      pointOfSale: data?.pointOfSale,
      connectedAt: integration.connectedAt || undefined,
      tokenExpiresAt: integration.tokenExpiresAt || undefined,
      lastError: data?.lastError,
      csr: data?.csr,
      csrGeneratedAt: data?.csrGeneratedAt,
    };
  }

  async generateCsr(workspaceId: string, input: {
    cuit: string;
    pointOfSale: number;
    environment: ArcaEnvironment;
  }): Promise<{ csr: string }> {
    const { default: forge } = await import('node-forge');
    const cuitDigits = input.cuit.replace(/\D/g, '');
    if (cuitDigits.length < 8) {
      throw new ArcaIntegrationError('CUIT inválido', 'INVALID_CUIT');
    }

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const csr = forge.pki.createCertificationRequest();
    csr.publicKey = keys.publicKey;
    csr.setSubject([
      { name: 'countryName', value: 'AR' },
      { name: 'organizationName', value: 'Nexova' },
      { name: 'organizationalUnitName', value: 'Integrations' },
      { name: 'commonName', value: `CUIT ${cuitDigits}` },
      { name: 'serialNumber', value: `CUIT ${cuitDigits}` },
    ]);
    csr.sign(keys.privateKey, forge.md.sha256.create());

    const csrPem = forge.pki.certificationRequestToPem(csr);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const keyEnc = encrypt(privateKeyPem);

    const providerData: ArcaProviderData = {
      cuit: input.cuit,
      environment: input.environment,
      pointOfSale: input.pointOfSale,
      service: SERVICE_NAME,
      keyEnc: keyEnc.encrypted,
      keyIv: keyEnc.iv,
      csr: csrPem,
      csrGeneratedAt: new Date().toISOString(),
    };

    await this.prisma.workspaceIntegration.upsert({
      where: {
        workspaceId_provider: {
          workspaceId,
          provider: PROVIDER_NAME,
        },
      },
      create: {
        workspaceId,
        provider: PROVIDER_NAME,
        status: 'pending',
        providerData: providerData as unknown as Prisma.InputJsonValue,
      },
      update: {
        status: 'pending',
        providerData: providerData as unknown as Prisma.InputJsonValue,
      },
    });

    return { csr: csrPem };
  }

  async connect(workspaceId: string, input: ArcaConnectionInput): Promise<WorkspaceIntegration> {
    const cert = input.certificate.trim();
    if (!cert) {
      throw new ArcaIntegrationError('Certificado requerido', 'MISSING_CERTIFICATE');
    }
    if (!cert.includes('BEGIN CERTIFICATE')) {
      throw new ArcaIntegrationError('El certificado debe estar en formato PEM', 'INVALID_CERTIFICATE');
    }

    let key = input.privateKey?.trim() || '';
    const existing = await this.getIntegration(workspaceId);
    const data = this.parseProviderData(existing);
    if (!key && data?.keyEnc && data?.keyIv) {
      key = decrypt({ encrypted: data.keyEnc, iv: data.keyIv });
    }

    if (!key) {
      const missingHint = data?.csr
        ? 'No encontramos la clave privada guardada. Generá un nuevo CSR en Nexova y volvé a crear el certificado en ARCA.'
        : 'Primero generá el CSR en Nexova (paso 1) y usalo para crear el certificado en ARCA.';
      throw new ArcaIntegrationError(missingHint, 'MISSING_CREDENTIALS');
    }

    await this.assertCertificateMatchesKey(cert, key);

    // If we already have a valid TA stored for this workspace/provider, reuse it.
    // WSAA may reject early refresh/re-login attempts with coe.alreadyAuthenticated.
    const cachedTicket = data && data.environment === input.environment ? this.decodeTicket(data) : null;
    let ticket: ArcaAccessTicket;
    if (cachedTicket && cachedTicket.expiresAt.getTime() > Date.now()) {
      ticket = cachedTicket;
    } else {
      try {
        ticket = await wsaaLogin({
          environment: input.environment,
          certificate: cert,
          privateKey: key,
          service: SERVICE_NAME,
        });
      } catch (error) {
        const code = typeof error === 'object' && error ? (error as { code?: unknown }).code : undefined;
        if (code === 'ALREADY_AUTHENTICATED' && cachedTicket && cachedTicket.expiresAt.getTime() > Date.now()) {
          ticket = cachedTicket;
        } else {
          throw error;
        }
      }
    }

    const certEnc = encrypt(cert);
    const keyEnc = encrypt(key);
    const taEnc = encrypt(JSON.stringify({ token: ticket.token, sign: ticket.sign }));

    const providerData: ArcaProviderData = {
      cuit: input.cuit,
      environment: input.environment,
      pointOfSale: input.pointOfSale,
      service: SERVICE_NAME,
      certEnc: certEnc.encrypted,
      certIv: certEnc.iv,
      keyEnc: keyEnc.encrypted,
      keyIv: keyEnc.iv,
      taEnc: taEnc.encrypted,
      taIv: taEnc.iv,
      taExpiresAt: ticket.expiresAt.toISOString(),
      csr: undefined,
      csrGeneratedAt: undefined,
    };
    const providerDataJson = providerData as unknown as Prisma.InputJsonValue;

    return this.prisma.workspaceIntegration.upsert({
      where: {
        workspaceId_provider: {
          workspaceId,
          provider: PROVIDER_NAME,
        },
      },
      create: {
        workspaceId,
        provider: PROVIDER_NAME,
        status: 'connected',
        providerData: providerDataJson,
        connectedAt: new Date(),
        tokenExpiresAt: ticket.expiresAt,
      },
      update: {
        status: 'connected',
        providerData: providerDataJson,
        connectedAt: new Date(),
        disconnectedAt: null,
        tokenExpiresAt: ticket.expiresAt,
      },
    });
  }

  async disconnect(workspaceId: string): Promise<void> {
    const integration = await this.getIntegration(workspaceId);
    if (!integration) return;

    const data = this.parseProviderData(integration);
    const preserved: ArcaProviderData = {
      cuit: data?.cuit || '',
      environment: data?.environment || 'test',
      pointOfSale: data?.pointOfSale || 1,
      service: data?.service || SERVICE_NAME,
      keyEnc: data?.keyEnc,
      keyIv: data?.keyIv,
      csr: data?.csr,
      csrGeneratedAt: data?.csrGeneratedAt,
      certEnc: data?.certEnc,
      certIv: data?.certIv,
      // Keep the last TA so a reconnect doesn't fail with coe.alreadyAuthenticated.
      taEnc: data?.taEnc,
      taIv: data?.taIv,
      taExpiresAt: data?.taExpiresAt,
      lastError: undefined,
    };

    await this.prisma.workspaceIntegration.update({
      where: { id: integration.id },
      data: {
        status: 'disconnected',
        providerData: preserved as unknown as Prisma.InputJsonValue,
        accessTokenEnc: null,
        accessTokenIv: null,
        refreshTokenEnc: null,
        refreshTokenIv: null,
        tokenExpiresAt: null,
        disconnectedAt: new Date(),
      },
    });
  }

  async healthCheck(workspaceId: string): Promise<{ ok: boolean; detail?: string }> {
    const { ticket, data } = await this.ensureAccessTicket(workspaceId);
    try {
      const dummy = await wsfeDummy(data.environment);
      return {
        ok: true,
        detail: `App:${dummy.appServer} DB:${dummy.dbServer} Auth:${dummy.authServer}`,
      };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Error desconocido' };
    }
  }

  async issueInvoice(workspaceId: string, request: ArcaInvoiceRequest): Promise<ArcaInvoiceResult> {
    const { ticket, data } = await this.ensureAccessTicket(workspaceId);
    const normalizedRequest: ArcaInvoiceRequest = {
      ...request,
      condicionIVAReceptorId: request.condicionIVAReceptorId ?? 5,
    };
    const pointOfSale = normalizedRequest.pointOfSale ?? data.pointOfSale;

    const lastNumber = await wsfeCompUltimoAutorizado({
      environment: data.environment,
      token: ticket.token,
      sign: ticket.sign,
      cuit: data.cuit,
      pointOfSale,
      cbteTipo: normalizedRequest.cbteTipo,
    });

    const result = await wsfeCaeSolicitar({
      environment: data.environment,
      token: ticket.token,
      sign: ticket.sign,
      cuit: data.cuit,
      pointOfSale,
      lastNumber,
      request: normalizedRequest,
    });

    return {
      approved: result.approved,
      cae: result.cae,
      caeExpiresAt: result.caeExpiresAt,
      cbteNro: result.cbteNro,
      raw: result.raw,
    };
  }

  async syncInvoicesForRange(
    workspaceId: string,
    input: {
      from: Date;
      cbteTypes?: number[];
      pointOfSale?: number;
      includeAllPointsOfSale?: boolean;
      maxIterations?: number;
    }
  ): Promise<{ synced: number; updated: number; skipped: number }> {
    const { ticket, data } = await this.ensureAccessTicket(workspaceId);
    const from = this.startOfDay(input.from);
    const defaultPointOfSale = input.pointOfSale ?? data.pointOfSale;
    const cbteTypes = input.cbteTypes?.length ? input.cbteTypes : [1, 6, 11];
    const maxIterations = input.maxIterations ?? 5000;

    let pointsOfSale = input.pointOfSale ? [input.pointOfSale] : [];
    if (!pointsOfSale.length && input.includeAllPointsOfSale !== false) {
      try {
        pointsOfSale = await wsfeParamGetPtosVenta({
          environment: data.environment,
          token: ticket.token,
          sign: ticket.sign,
          cuit: data.cuit,
        });
      } catch {
        pointsOfSale = [];
      }
    }
    if (!pointsOfSale.length) {
      pointsOfSale = [defaultPointOfSale];
    }

    const nexovaInvoices = await this.prisma.arcaInvoice.findMany({
      where: {
        workspaceId,
        status: 'authorized',
        cbteTipo: { in: cbteTypes },
        pointOfSale: { in: pointsOfSale },
      },
      select: {
        cbteTipo: true,
        cbteNro: true,
        pointOfSale: true,
      },
    });

    const nexovaKeys = new Set(nexovaInvoices.map((row) => `${row.pointOfSale}:${row.cbteTipo}:${row.cbteNro}`));

    let synced = 0;
    let updated = 0;
    let skipped = 0;

    for (const pointOfSale of pointsOfSale) {
      for (const cbteTipo of cbteTypes) {
        const lastNumber = await wsfeCompUltimoAutorizado({
          environment: data.environment,
          token: ticket.token,
          sign: ticket.sign,
          cuit: data.cuit,
          pointOfSale,
          cbteTipo,
        });

        let iterations = 0;
        for (let cbteNro = lastNumber; cbteNro >= 1; cbteNro -= 1) {
          iterations += 1;
          if (iterations > maxIterations) {
            break;
          }

          const key = `${pointOfSale}:${cbteTipo}:${cbteNro}`;
          const existing = await this.prisma.arcaInvoiceRecord.findUnique({
            where: {
              workspaceId_pointOfSale_cbteTipo_cbteNro: {
                workspaceId,
                pointOfSale,
                cbteTipo,
                cbteNro,
              },
            },
          });

          if (existing) {
            if (existing.cbteFch < from) {
              break;
            }
            const origin = nexovaKeys.has(key) ? 'nexova' : 'external';
            if (existing.origin !== origin) {
              await this.prisma.arcaInvoiceRecord.update({
                where: { id: existing.id },
                data: { origin },
              });
              updated += 1;
            }
            skipped += 1;
            continue;
          }

          let detail: ArcaInvoiceLookup | null = null;
          try {
            detail = await wsfeCompConsultar({
              environment: data.environment,
              token: ticket.token,
              sign: ticket.sign,
              cuit: data.cuit,
              pointOfSale,
              cbteTipo,
              cbteNro,
            });
          } catch {
            continue;
          }

          if (!detail) {
            continue;
          }

          const issuedAt = this.parseArcaDate(detail.cbteFch);
          if (!issuedAt) {
            continue;
          }

          if (issuedAt < from) {
            break;
          }

          const totalCents = Math.round(detail.impTotal * 100);
          const origin = nexovaKeys.has(key) ? 'nexova' : 'external';

          await this.prisma.arcaInvoiceRecord.create({
            data: {
              workspaceId,
              pointOfSale,
              cbteTipo,
              cbteNro,
              cbteFch: issuedAt,
              total: totalCents,
              currency: 'ARS',
              docTipo: detail.docTipo || 0,
              docNro: detail.docNro || '',
              status: 'authorized',
              origin,
            },
          });

          synced += 1;
        }
      }
    }

    return { synced, updated, skipped };
  }

  private decryptCredentials(data: ArcaProviderData): { certificate: string; privateKey: string } {
    if (!data.certEnc || !data.certIv || !data.keyEnc || !data.keyIv) {
      throw new ArcaIntegrationError('Credenciales de ARCA incompletas', 'INVALID_CREDENTIALS');
    }
    const certificate = decrypt({ encrypted: data.certEnc, iv: data.certIv });
    const privateKey = decrypt({ encrypted: data.keyEnc, iv: data.keyIv });
    return { certificate, privateKey };
  }

  private async assertCertificateMatchesKey(certificate: string, privateKey: string): Promise<void> {
    try {
      const { default: forge } = await import('node-forge');
      const cert = forge.pki.certificateFromPem(certificate);
      const key = forge.pki.privateKeyFromPem(privateKey);
      const publicFromKey = forge.pki.setRsaPublicKey(key.n, key.e);

      const sameModulus =
        cert.publicKey && 'n' in cert.publicKey && cert.publicKey.n.equals(publicFromKey.n);
      if (!sameModulus) {
        throw new ArcaIntegrationError('La clave privada no corresponde al certificado', 'KEY_MISMATCH');
      }
    } catch (error) {
      if (error instanceof ArcaIntegrationError) throw error;
      throw new ArcaIntegrationError('No se pudo validar el certificado y la clave', 'INVALID_CREDENTIALS');
    }
  }

  private decodeTicket(data: ArcaProviderData): ArcaAccessTicket | null {
    if (!data.taEnc || !data.taIv || !data.taExpiresAt) return null;
    try {
      const raw = decrypt({ encrypted: data.taEnc, iv: data.taIv });
      const parsed = JSON.parse(raw) as { token?: string; sign?: string };
      if (!parsed.token || !parsed.sign) return null;
      return {
        token: parsed.token,
        sign: parsed.sign,
        expiresAt: new Date(data.taExpiresAt),
      };
    } catch {
      return null;
    }
  }

  private parseArcaDate(value?: string | null): Date | null {
    if (!value) return null;
    const normalized = value.replace(/[^0-9]/g, '');
    if (normalized.length !== 8) return null;
    const year = Number(normalized.slice(0, 4));
    const month = Number(normalized.slice(4, 6));
    const day = Number(normalized.slice(6, 8));
    if (!year || !month || !day) return null;
    return new Date(Date.UTC(year, month - 1, day));
  }

  private startOfDay(date: Date): Date {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  private async ensureAccessTicket(workspaceId: string): Promise<{ ticket: ArcaAccessTicket; data: ArcaProviderData }> {
    const integration = await this.getIntegration(workspaceId);
    if (!integration || integration.status !== 'connected') {
      throw new ArcaIntegrationError('ARCA no está conectado', 'NOT_CONNECTED');
    }

    const data = this.parseProviderData(integration);
    if (!data || !data.certEnc || !data.keyEnc) {
      throw new ArcaIntegrationError('Credenciales de ARCA incompletas', 'INVALID_CREDENTIALS');
    }

    const cached = this.decodeTicket(data);
    if (cached && cached.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
      return { ticket: cached, data };
    }

    const { certificate, privateKey } = this.decryptCredentials(data);
    let ticket: ArcaAccessTicket;
    try {
      ticket = await wsaaLogin({
        environment: data.environment,
        certificate,
        privateKey,
        service: data.service || SERVICE_NAME,
      });
    } catch (error) {
      const code = typeof error === 'object' && error ? (error as { code?: unknown }).code : undefined;
      if (code === 'ALREADY_AUTHENTICATED') {
        // Another concurrent request/process may have refreshed the TA.
        const refreshed = await this.getIntegration(workspaceId);
        const refreshedData = this.parseProviderData(refreshed);
        if (refreshed && refreshedData) {
          const existing = this.decodeTicket(refreshedData);
          if (existing && existing.expiresAt.getTime() > Date.now()) {
            await this.prisma.workspaceIntegration.update({
              where: { id: refreshed.id },
              data: { lastUsedAt: new Date() },
            });
            return { ticket: existing, data: refreshedData };
          }
        }
      }
      throw error;
    }

    const taEnc = encrypt(JSON.stringify({ token: ticket.token, sign: ticket.sign }));

    const providerData: ArcaProviderData = {
      ...data,
      taEnc: taEnc.encrypted,
      taIv: taEnc.iv,
      taExpiresAt: ticket.expiresAt.toISOString(),
      lastError: undefined,
    };
    const providerDataJson = providerData as unknown as Prisma.InputJsonValue;

    await this.prisma.workspaceIntegration.update({
      where: { id: integration.id },
      data: {
        providerData: providerDataJson,
        tokenExpiresAt: ticket.expiresAt,
        lastUsedAt: new Date(),
      },
    });

    return { ticket, data: providerData };
  }
}
