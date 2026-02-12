export type ArcaEnvironment = 'test' | 'prod';

export interface ArcaConnectionInput {
  cuit: string;
  pointOfSale: number;
  certificate: string;
  privateKey?: string;
  environment: ArcaEnvironment;
}

export interface ArcaIntegrationStatus {
  connected: boolean;
  status: string;
  cuit?: string;
  environment?: ArcaEnvironment;
  pointOfSale?: number;
  connectedAt?: Date;
  tokenExpiresAt?: Date;
  lastError?: string;
  csr?: string;
  csrGeneratedAt?: string;
}

export interface ArcaAccessTicket {
  token: string;
  sign: string;
  expiresAt: Date;
}

export interface ArcaInvoiceRequest {
  pointOfSale?: number;
  cbteTipo: number;
  concept: number;
  docTipo: number;
  docNro: number;
  cbteFch?: string;
  impTotal: number;
  impNeto: number;
  impIVA?: number;
  impTrib?: number;
  impOpEx?: number;
  impTotConc?: number;
  monId?: string;
  monCotiz?: number;
  condicionIVAReceptorId: number;
  iva?: Array<{ Id: number; BaseImp: number; Importe: number }>;
  orderId?: string;
}

export interface ArcaInvoiceResult {
  approved: boolean;
  cae?: string;
  caeExpiresAt?: string;
  cbteNro?: number;
  raw: unknown;
}

export interface ArcaInvoiceLookup {
  cbteTipo: number;
  cbteNro: number;
  pointOfSale: number;
  cbteFch: string;
  impTotal: number;
  docTipo: number;
  docNro: string;
  raw: unknown;
}

export class ArcaIntegrationError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
