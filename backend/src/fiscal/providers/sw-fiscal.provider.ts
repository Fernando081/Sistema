import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { CancelInput, CancelResult, FiscalProvider, FiscalSettings, FiscalStatusResult, StampInput, StampResult } from '../fiscal.types';

interface SwEnvelope { status?: string; message?: string; messageDetail?: string; data?: Record<string, unknown> | null; }

const xmlValue = (xml: string, localName: string) => {
  const match = xml.match(new RegExp(`<(?:\\w+:)?${localName}[^>]*>([^<]*)<\\/(?:\\w+:)?${localName}>`, 'i'));
  return match?.[1]?.trim();
};

const decodePossibleBase64 = (value: string) => {
  if (value.trim().startsWith('<')) return value;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return decoded.trim().startsWith('<') ? decoded : value;
  } catch {
    return value;
  }
};
const stringValue = (value: unknown, fallback = '') =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
const numberValue = (value: unknown, fallback: number) => {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

export class SwFiscalProvider implements FiscalProvider {
  readonly name = 'sw';
  readonly environment;
  private token?: string;
  private tokenExpiresAt = 0;

  constructor(private readonly settings: FiscalSettings) {
    this.environment = settings.environment;
    this.token = settings.sw?.token;
    if (this.token) this.tokenExpiresAt = Number.MAX_SAFE_INTEGER;
  }

  private async request(url: string, init: RequestInit): Promise<SwEnvelope> {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new ServiceUnavailableException('El PAC no respondió dentro del tiempo esperado');
    }
    const body = await response.json().catch(() => null) as SwEnvelope | null;
    if (!response.ok || !body || body.status === 'error') {
      const detail = body?.messageDetail || body?.message || `HTTP ${response.status}`;
      throw new BadGatewayException(`El PAC rechazó la operación: ${detail}`);
    }
    return body;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const sw = this.settings.sw;
    if (!sw?.user || !sw.password) throw new ServiceUnavailableException('Credenciales del PAC incompletas');
    const response = await this.request(`${sw.servicesUrl}/v2/security/authenticate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: sw.user, password: sw.password }),
    });
    const data = response.data || {};
    const token = stringValue(data['token']) || stringValue(data['Token']);
    if (!token) throw new BadGatewayException('El PAC no devolvió un token utilizable');
    const expiresIn = numberValue(data['expires_in'] ?? data['expiresIn'], 7200);
    this.token = token;
    this.tokenExpiresAt = Date.now() + Math.max(60, expiresIn) * 1000;
    return token;
  }

  async stamp(input: StampInput): Promise<StampResult> {
    const token = await this.accessToken();
    const sw = this.settings.sw!;
    const response = await this.request(`${sw.servicesUrl}/cfdi33/issue/json/v4/b64`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: Buffer.from(input.xml, 'utf8').toString('base64') }),
    });
    const data = response.data || {};
    const uuid = stringValue(data['uuid']);
    const rawXml = stringValue(data['cfdi']) || stringValue(data['xml']) || stringValue(data['cfdiBase64']);
    if (!uuid || !rawXml) throw new BadGatewayException('El PAC respondió sin UUID o XML timbrado');
    return {
      uuid,
      xml: decodePossibleBase64(rawXml),
      stampedAt: stringValue(data['fechaTimbrado'], new Date().toISOString()),
      satCertificate: stringValue(data['noCertificadoSAT']),
      cfdiCertificate: stringValue(data['noCertificadoCFDI']),
      satSeal: stringValue(data['selloSAT']),
      cfdiSeal: stringValue(data['selloCFDI']),
      satOriginalString: stringValue(data['cadenaOriginalSAT']),
      providerCode: response.message || 'success',
      providerMessage: response.messageDetail || response.message,
    };
  }

  async cancel(input: CancelInput): Promise<CancelResult> {
    const token = await this.accessToken();
    const sw = this.settings.sw!;
    const replacement = input.replacementUuid ? `/${encodeURIComponent(input.replacementUuid)}` : '';
    const path = [input.issuerRfc, input.uuid, input.receiverRfc, input.total.toFixed(2), input.reason]
      .map(encodeURIComponent).join('/');
    const response = await this.request(`${sw.servicesUrl}/cfdi33/cancel/${path}${replacement}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    const data = response.data || {};
    const acknowledgement = stringValue(data['acuse']) || stringValue(data['acknowledgement']);
    const item = (data['uuid'] as Record<string, Record<string, unknown>> | undefined)?.[input.uuid]
      || (data['uuid'] as Record<string, Record<string, unknown>> | undefined)?.[input.uuid.toUpperCase()]
      || {};
    const code = stringValue(item['code']) || stringValue(data['code']) || stringValue(data['codStatus']);
    const message = stringValue(item['message']) || stringValue(item['description'])
      || stringValue(data['message']) || response.message || '';
    const serialized = JSON.stringify(data).toLowerCase();
    const cancelled = code === '202' || serialized.includes('cancelado');
    return { accepted: true, cancelled, acknowledgement, code, message };
  }

  async queryStatus(input: CancelInput): Promise<FiscalStatusResult> {
    const sw = this.settings.sw!;
    const printedExpression = `?re=${input.issuerRfc}&rr=${input.receiverRfc}&tt=${input.total.toFixed(6)}&id=${input.uuid}&fe=${input.cfdiSeal.slice(-8)}`;
    const soap = `<?xml version="1.0" encoding="utf-8"?>\n<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/"><soapenv:Header/><soapenv:Body><tem:Consulta><tem:expresionImpresa><![CDATA[${printedExpression}]]></tem:expresionImpresa></tem:Consulta></soapenv:Body></soapenv:Envelope>`;
    let response: Response;
    try {
      response = await fetch(`${sw.statusUrl}/ConsultaCFDIService.svc`, {
        method: 'POST', signal: AbortSignal.timeout(30_000),
        headers: { Accept: 'text/xml', 'Content-Type': 'text/xml;charset="utf-8"', SOAPAction: 'http://tempuri.org/IConsultaCFDIService/Consulta' },
        body: soap,
      });
    } catch {
      throw new ServiceUnavailableException('No fue posible consultar el estado del CFDI');
    }
    const xml = await response.text();
    if (!response.ok) throw new BadGatewayException(`La consulta SAT respondió HTTP ${response.status}`);
    const value = xmlValue(xml, 'Estado') || 'Desconocido';
    const status = ['Vigente', 'Cancelado'].includes(value)
      ? value as 'Vigente' | 'Cancelado'
      : value.toLowerCase().includes('no encontrado') ? 'No encontrado' : 'Desconocido';
    return {
      status,
      cancellableStatus: xmlValue(xml, 'EsCancelable'),
      cancellationStatus: xmlValue(xml, 'EstatusCancelacion'),
      rawCode: xmlValue(xml, 'CodigoEstatus'),
    };
  }
}
