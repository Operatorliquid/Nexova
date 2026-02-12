import forge from 'node-forge';
import { XMLParser } from 'fast-xml-parser';
import type { ArcaAccessTicket, ArcaEnvironment, ArcaInvoiceRequest, ArcaInvoiceLookup } from './types.js';

const WSAA_URLS: Record<ArcaEnvironment, string> = {
  test: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  prod: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};

const WSFE_URLS: Record<ArcaEnvironment, string> = {
  test: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  prod: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};

const SOAP_NS = 'http://schemas.xmlsoap.org/soap/envelope/';
const WSAA_NS = 'http://wsaa.view.sua.dvadac.desein.afip.gov';
const WSFE_NS = 'http://ar.gov.afip.dif.FEV1/';

const parser = new XMLParser({
  ignoreAttributes: false,
  processEntities: true,
  trimValues: true,
});

function toIso(value: Date): string {
  return value.toISOString();
}

function buildLoginTicketRequest(service: string): string {
  const now = new Date();
  const generationTime = new Date(now.getTime() - 10 * 60 * 1000);
  const expirationTime = new Date(now.getTime() + 10 * 60 * 1000);

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<loginTicketRequest version="1.0">\n` +
    `  <header>\n` +
    `    <uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>\n` +
    `    <generationTime>${toIso(generationTime)}</generationTime>\n` +
    `    <expirationTime>${toIso(expirationTime)}</expirationTime>\n` +
    `  </header>\n` +
    `  <service>${service}</service>\n` +
    `</loginTicketRequest>`;
}

function buildSoapEnvelope(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<soapenv:Envelope xmlns:soapenv="${SOAP_NS}">\n` +
    `  <soapenv:Header/>\n` +
    `  <soapenv:Body>\n${body}\n  </soapenv:Body>\n` +
    `</soapenv:Envelope>`;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function findNestedValue(obj: unknown, keyName: string): unknown {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findNestedValue(item, keyName);
      if (found !== null && found !== undefined) return found;
    }
    return null;
  }
  const record = obj as Record<string, unknown>;
  if (record[keyName] !== undefined) return record[keyName];
  for (const key of Object.keys(record)) {
    const found = findNestedValue(record[key], keyName);
    if (found !== null && found !== undefined) return found;
  }
  return null;
}

type WsaaSignAlgorithm = 'sha1' | 'sha256';

class WsaaLoginError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function resolveDigestAlgorithm(algorithm: WsaaSignAlgorithm): { algo: string; digest: forge.md.MessageDigest } {
  if (algorithm === 'sha256') {
    return { algo: forge.pki.oids.sha256, digest: forge.md.sha256.create() };
  }
  return { algo: forge.pki.oids.sha1, digest: forge.md.sha1.create() };
}

function signCms(
  loginTicketRequest: string,
  certificate: string,
  privateKey: string,
  algorithm: WsaaSignAlgorithm,
  detached: boolean
): string {
  const cert = forge.pki.certificateFromPem(certificate);
  const key = forge.pki.privateKeyFromPem(privateKey);
  const digest = resolveDigestAlgorithm(algorithm);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(loginTicketRequest, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: digest.algo,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached });

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

export async function wsaaLogin(params: {
  environment: ArcaEnvironment;
  certificate: string;
  privateKey: string;
  service: string;
}): Promise<ArcaAccessTicket> {
  const preferred = (process.env.ARCA_WSAA_SIGN_ALG || 'sha1').toLowerCase() === 'sha256' ? 'sha256' : 'sha1';
  const fallback: WsaaSignAlgorithm = preferred === 'sha1' ? 'sha256' : 'sha1';

  try {
    return await wsaaLoginWithAlg({ ...params, algorithm: preferred, detached: true });
  } catch (error) {
    if (error instanceof WsaaLoginError && error.code === 'CMS_SIGN_INVALID') {
      try {
        return await wsaaLoginWithAlg({ ...params, algorithm: preferred, detached: false });
      } catch (second) {
        if (second instanceof WsaaLoginError && second.code === 'CMS_SIGN_INVALID') {
          try {
            return await wsaaLoginWithAlg({ ...params, algorithm: fallback, detached: true });
          } catch (third) {
            if (third instanceof WsaaLoginError && third.code === 'CMS_SIGN_INVALID') {
              return await wsaaLoginWithAlg({ ...params, algorithm: fallback, detached: false });
            }
            throw third;
          }
        }
        throw second;
      }
    }
    throw error;
  }
}

async function wsaaLoginWithAlg(params: {
  environment: ArcaEnvironment;
  certificate: string;
  privateKey: string;
  service: string;
  algorithm: WsaaSignAlgorithm;
  detached: boolean;
}): Promise<ArcaAccessTicket> {
  const { environment, certificate, privateKey, service } = params;
  const loginTicketRequest = buildLoginTicketRequest(service);
  const cms = signCms(loginTicketRequest, certificate, privateKey, params.algorithm, params.detached);
  const body = `  <wsaa:loginCms xmlns:wsaa="${WSAA_NS}">\n` +
    `    <wsaa:in0>${cms}</wsaa:in0>\n` +
    `  </wsaa:loginCms>`;
  const envelope = buildSoapEnvelope(body);

  const response = await fetch(WSAA_URLS[environment], {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: 'loginCms',
    },
    body: envelope,
  });

  const text = await response.text();
  if (!response.ok) {
    const faultCode = extractTag(text, 'faultcode') || '';
    const faultString = extractTag(text, 'faultstring') || '';
    if (faultCode.includes('cms.sign.invalid')) {
      throw new WsaaLoginError('Firma inválida o algoritmo no soportado. Verificá certificado y clave.', 'CMS_SIGN_INVALID');
    }
    const combined = `${faultCode} ${faultString}`.toLowerCase();
    if (combined.includes('alreadyauthenticated')) {
      // AFIP returns "coe.alreadyAuthenticated" when the certificate already has a valid TA for this service.
      throw new WsaaLoginError('WSAA ya posee un TA válido para el servicio solicitado.', 'ALREADY_AUTHENTICATED');
    }
    throw new WsaaLoginError(`WSAA login failed (${response.status}): ${text}`);
  }

  let loginCmsReturn = extractTag(text, 'loginCmsReturn');
  if (!loginCmsReturn) {
    const parsed = parser.parse(text);
    const found = findNestedValue(parsed, 'loginCmsReturn');
    if (typeof found === 'string') loginCmsReturn = found;
  }

  if (!loginCmsReturn) {
    throw new Error('WSAA login response missing loginCmsReturn');
  }

  const decoded = decodeXmlEntities(loginCmsReturn);
  const ticket = parser.parse(decoded);

  const token = findNestedValue(ticket, 'token');
  const sign = findNestedValue(ticket, 'sign');
  const expirationTime = findNestedValue(ticket, 'expirationTime');

  if (typeof token !== 'string' || typeof sign !== 'string' || typeof expirationTime !== 'string') {
    throw new Error('WSAA login response missing token/sign');
  }

  return {
    token,
    sign,
    expiresAt: new Date(expirationTime),
  };
}

async function callWsfe(params: {
  environment: ArcaEnvironment;
  action: string;
  payload: string;
}): Promise<string> {
  const { environment, action, payload } = params;
  const body = `<ar:${action} xmlns:ar="${WSFE_NS}">\n${payload}\n</ar:${action}>`;
  const envelope = buildSoapEnvelope(body);

  const response = await fetch(WSFE_URLS[environment], {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: `"${WSFE_NS}${action}"`,
    },
    body: envelope,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`WSFE ${action} failed (${response.status}): ${text}`);
  }
  return text;
}

export async function wsfeDummy(environment: ArcaEnvironment): Promise<{ appServer: string; dbServer: string; authServer: string }> {
  const payload = '';
  const xml = await callWsfe({ environment, action: 'FEDummy', payload });
  const parsed = parser.parse(xml);
  const result = findNestedValue(parsed, 'FEDummyResult') as Record<string, unknown> | null;
  if (!result || typeof result !== 'object') {
    throw new Error('WSFE dummy response invalid');
  }
  return {
    appServer: String((result as any).AppServer || ''),
    dbServer: String((result as any).DbServer || ''),
    authServer: String((result as any).AuthServer || ''),
  };
}

export async function wsfeCompUltimoAutorizado(params: {
  environment: ArcaEnvironment;
  token: string;
  sign: string;
  cuit: string;
  pointOfSale: number;
  cbteTipo: number;
}): Promise<number> {
  const payload = `  <ar:Auth>\n` +
    `    <ar:Token>${params.token}</ar:Token>\n` +
    `    <ar:Sign>${params.sign}</ar:Sign>\n` +
    `    <ar:Cuit>${params.cuit}</ar:Cuit>\n` +
    `  </ar:Auth>\n` +
    `  <ar:PtoVta>${params.pointOfSale}</ar:PtoVta>\n` +
    `  <ar:CbteTipo>${params.cbteTipo}</ar:CbteTipo>`;

  const xml = await callWsfe({ environment: params.environment, action: 'FECompUltimoAutorizado', payload });
  const parsed = parser.parse(xml);
  const result = findNestedValue(parsed, 'FECompUltimoAutorizadoResult') as Record<string, unknown> | null;
  const number = result ? (result as any).CbteNro : null;
  const parsedNumber = Number(number);
  if (!Number.isFinite(parsedNumber)) {
    throw new Error('No se pudo obtener el último comprobante autorizado');
  }
  return parsedNumber;
}

export async function wsfeCompConsultar(params: {
  environment: ArcaEnvironment;
  token: string;
  sign: string;
  cuit: string;
  pointOfSale: number;
  cbteTipo: number;
  cbteNro: number;
}): Promise<ArcaInvoiceLookup | null> {
  const payload = `  <ar:Auth>\n` +
    `    <ar:Token>${params.token}</ar:Token>\n` +
    `    <ar:Sign>${params.sign}</ar:Sign>\n` +
    `    <ar:Cuit>${params.cuit}</ar:Cuit>\n` +
    `  </ar:Auth>\n` +
    `  <ar:FeCompConsReq>\n` +
    `    <ar:PtoVta>${params.pointOfSale}</ar:PtoVta>\n` +
    `    <ar:CbteTipo>${params.cbteTipo}</ar:CbteTipo>\n` +
    `    <ar:CbteNro>${params.cbteNro}</ar:CbteNro>\n` +
    `  </ar:FeCompConsReq>`;

  const xml = await callWsfe({ environment: params.environment, action: 'FECompConsultar', payload });
  const parsed = parser.parse(xml);
  const result = findNestedValue(parsed, 'FECompConsultarResult') as Record<string, unknown> | null;
  const detail = result ? (findNestedValue(result, 'ResultGet') as Record<string, unknown> | null) : null;

  if (!detail || typeof detail !== 'object') {
    return null;
  }

  const cbteFch = String((detail as any).CbteFch || '');
  const impTotalRaw = (detail as any).ImpTotal;
  const docTipoRaw = (detail as any).DocTipo;
  const docNroRaw = (detail as any).DocNro;

  const impTotal = Number(impTotalRaw);
  const docTipo = Number(docTipoRaw);
  const docNro = docNroRaw !== undefined && docNroRaw !== null ? String(docNroRaw) : '';

  if (!cbteFch || !Number.isFinite(impTotal)) {
    return null;
  }

  return {
    cbteTipo: params.cbteTipo,
    cbteNro: params.cbteNro,
    pointOfSale: params.pointOfSale,
    cbteFch,
    impTotal,
    docTipo: Number.isFinite(docTipo) ? docTipo : 0,
    docNro,
    raw: detail,
  };
}

export async function wsfeParamGetPtosVenta(params: {
  environment: ArcaEnvironment;
  token: string;
  sign: string;
  cuit: string;
}): Promise<number[]> {
  const payload = `  <ar:Auth>\n` +
    `    <ar:Token>${params.token}</ar:Token>\n` +
    `    <ar:Sign>${params.sign}</ar:Sign>\n` +
    `    <ar:Cuit>${params.cuit}</ar:Cuit>\n` +
    `  </ar:Auth>`;

  const xml = await callWsfe({ environment: params.environment, action: 'FEParamGetPtosVenta', payload });
  const parsed = parser.parse(xml);
  const result = findNestedValue(parsed, 'FEParamGetPtosVentaResult') as Record<string, unknown> | null;
  const items = result ? (findNestedValue(result, 'ResultGet') as any) : null;

  const rows = Array.isArray(items) ? items : items ? [items] : [];
  const points: number[] = [];
  rows.forEach((row) => {
    const value = Number((row as any).PtoVta ?? (row as any).PtoVtaNro ?? (row as any).ptoVta);
    if (Number.isFinite(value)) {
      points.push(value);
    }
  });

  return points;
}

export async function wsfeCaeSolicitar(params: {
  environment: ArcaEnvironment;
  token: string;
  sign: string;
  cuit: string;
  pointOfSale: number;
  lastNumber: number;
  request: ArcaInvoiceRequest;
}): Promise<{ cae?: string; caeExpiresAt?: string; cbteNro?: number; raw: unknown; approved: boolean }> {
  const cbteNro = params.lastNumber + 1;
  const req = params.request;
  const cbteFch = req.cbteFch || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const impIVA = req.impIVA ?? 0;
  const impTrib = req.impTrib ?? 0;
  const impOpEx = req.impOpEx ?? 0;
  const impTotConc = req.impTotConc ?? 0;
  const monId = req.monId || 'PES';
  const monCotiz = req.monCotiz ?? 1;
  const condicionIVAReceptorId = req.condicionIVAReceptorId ?? 5;

  const ivaXml = Array.isArray(req.iva) && req.iva.length > 0
    ? `      <ar:Iva>\n${req.iva
        .map(
          (item) => `        <ar:AlicIva>\n          <ar:Id>${item.Id}</ar:Id>\n          <ar:BaseImp>${item.BaseImp}</ar:BaseImp>\n          <ar:Importe>${item.Importe}</ar:Importe>\n        </ar:AlicIva>`
        )
        .join('\n')}\n      </ar:Iva>\n`
    : '';

  const payload = `  <ar:Auth>\n` +
    `    <ar:Token>${params.token}</ar:Token>\n` +
    `    <ar:Sign>${params.sign}</ar:Sign>\n` +
    `    <ar:Cuit>${params.cuit}</ar:Cuit>\n` +
    `  </ar:Auth>\n` +
    `  <ar:FeCAEReq>\n` +
    `    <ar:FeCabReq>\n` +
    `      <ar:CantReg>1</ar:CantReg>\n` +
    `      <ar:PtoVta>${params.pointOfSale}</ar:PtoVta>\n` +
    `      <ar:CbteTipo>${req.cbteTipo}</ar:CbteTipo>\n` +
    `    </ar:FeCabReq>\n` +
    `    <ar:FeDetReq>\n` +
    `      <ar:FECAEDetRequest>\n` +
    `        <ar:Concepto>${req.concept}</ar:Concepto>\n` +
    `        <ar:DocTipo>${req.docTipo}</ar:DocTipo>\n` +
    `        <ar:DocNro>${req.docNro}</ar:DocNro>\n` +
    `        <ar:CondicionIVAReceptorId>${condicionIVAReceptorId}</ar:CondicionIVAReceptorId>\n` +
    `        <ar:CbteDesde>${cbteNro}</ar:CbteDesde>\n` +
    `        <ar:CbteHasta>${cbteNro}</ar:CbteHasta>\n` +
    `        <ar:CbteFch>${cbteFch}</ar:CbteFch>\n` +
    `        <ar:ImpTotal>${req.impTotal}</ar:ImpTotal>\n` +
    `        <ar:ImpTotConc>${impTotConc}</ar:ImpTotConc>\n` +
    `        <ar:ImpNeto>${req.impNeto}</ar:ImpNeto>\n` +
    `        <ar:ImpOpEx>${impOpEx}</ar:ImpOpEx>\n` +
    `        <ar:ImpIVA>${impIVA}</ar:ImpIVA>\n` +
    `        <ar:ImpTrib>${impTrib}</ar:ImpTrib>\n` +
    `        <ar:MonId>${monId}</ar:MonId>\n` +
    `        <ar:MonCotiz>${monCotiz}</ar:MonCotiz>\n` +
    (ivaXml ? ivaXml : '') +
    `      </ar:FECAEDetRequest>\n` +
    `    </ar:FeDetReq>\n` +
    `  </ar:FeCAEReq>`;

  const xml = await callWsfe({ environment: params.environment, action: 'FECAESolicitar', payload });
  const parsed = parser.parse(xml);
  const result = findNestedValue(parsed, 'FECAESolicitarResult') as Record<string, unknown> | null;
  if (!result) {
    throw new Error('Respuesta FECAESolicitar inválida');
  }

  const detail = findNestedValue(result, 'FECAEDetResponse') as Record<string, unknown> | null;
  const cae = detail ? (detail as any).CAE : undefined;
  const caeFchVto = detail ? (detail as any).CAEFchVto : undefined;
  const resultado = detail ? (detail as any).Resultado : undefined;
  const approved = typeof resultado === 'string' ? resultado.toUpperCase() === 'A' : false;

  return {
    cae: typeof cae === 'string' ? cae : undefined,
    caeExpiresAt: typeof caeFchVto === 'string' ? caeFchVto : undefined,
    cbteNro,
    raw: result,
    approved,
  };
}
