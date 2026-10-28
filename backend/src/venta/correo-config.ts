import { isEmail } from 'class-validator';

/**
 * O01.2b · Configuración del envío de documentos por correo, validada al arrancar y en cada lote.
 * Por defecto está desactivada: sólo `MAIL_MODE=smtp` con datos válidos permite preparar envíos reales.
 * La contraseña nunca se expone; el estado público sólo dice si existe.
 */
export interface CorreoConfig {
  habilitado: boolean;
  modo: 'desactivado' | 'smtp';
  problemas: string[];
  smtp: { host: string; port: number; secure: boolean; requireTLS: boolean; rejectUnauthorized: boolean; user?: string; pass?: string };
  remitente: string;
  responderA?: string;
  dominiosPermitidos: string[];
  maxIntentos: number;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const truthy = (value: string | undefined) => ['1', 'true', 'yes', 'si', 'sí', 'on'].includes((value ?? '').trim().toLowerCase());

export function leerCorreoConfig(env: NodeJS.ProcessEnv = process.env): CorreoConfig {
  const problemas: string[] = [];
  const modoRaw = (env.MAIL_MODE ?? 'desactivado').trim().toLowerCase();
  const modo = modoRaw === 'smtp' ? 'smtp' : 'desactivado';
  if (!['smtp', 'desactivado', ''].includes(modoRaw)) problemas.push('MAIL_MODE debe ser "desactivado" o "smtp"');
  const host = (env.SMTP_HOST ?? '').trim();
  const port = Number(env.SMTP_PORT ?? 587);
  const secure = truthy(env.SMTP_SECURE);
  const requireTLS = truthy(env.SMTP_REQUIRE_TLS);
  const rejectUnauthorized = env.SMTP_TLS_REJECT_UNAUTHORIZED === undefined ? true : truthy(env.SMTP_TLS_REJECT_UNAUTHORIZED);
  const user = env.SMTP_USER?.trim() || undefined;
  const pass = env.SMTP_PASSWORD || undefined;
  const remitente = (env.MAIL_FROM ?? '').trim();
  const responderA = env.MAIL_REPLY_TO?.trim() || undefined;
  const dominiosPermitidos = (env.MAIL_RECIPIENT_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const maxIntentos = Number(env.MAIL_MAX_ATTEMPTS ?? 4);
  if (modo === 'smtp') {
    if (!host) problemas.push('Falta SMTP_HOST');
    if (!Number.isInteger(port) || port < 1 || port > 65535) problemas.push('SMTP_PORT inválido');
    if (!remitente || !isEmail(remitente) || /[\r\n<>,;]/.test(remitente)) problemas.push('MAIL_FROM debe ser una sola dirección válida');
    if (responderA && (!isEmail(responderA) || /[\r\n<>,;]/.test(responderA))) problemas.push('MAIL_REPLY_TO inválido');
    if (!LOOPBACK.has(host) && !secure && !requireTLS) problemas.push('Un servidor que no es local exige SMTP_SECURE=true o SMTP_REQUIRE_TLS=true');
    if (!LOOPBACK.has(host) && !rejectUnauthorized && env.NODE_ENV === 'production') problemas.push('En producción el certificado TLS del servidor SMTP debe verificarse');
    if ((user && !pass) || (!user && pass)) problemas.push('SMTP_USER y SMTP_PASSWORD van juntos');
    if (dominiosPermitidos.some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))) problemas.push('MAIL_RECIPIENT_DOMAINS contiene un dominio inválido');
    if (!Number.isInteger(maxIntentos) || maxIntentos < 1 || maxIntentos > 10) problemas.push('MAIL_MAX_ATTEMPTS debe estar entre 1 y 10');
  }
  return {
    habilitado: modo === 'smtp' && problemas.length === 0,
    modo, problemas,
    smtp: { host, port, secure, requireTLS, rejectUnauthorized, user, pass },
    remitente, responderA, dominiosPermitidos,
    maxIntentos: Number.isInteger(maxIntentos) && maxIntentos >= 1 && maxIntentos <= 10 ? maxIntentos : 4,
  };
}

/** Estado sin secretos para la pantalla y la API. */
export function correoConfigPublica(config: CorreoConfig) {
  return {
    modo: config.modo,
    habilitado: config.habilitado,
    servidor: config.smtp.host ? `${config.smtp.host}:${config.smtp.port}` : null,
    tls: config.smtp.secure ? 'TLS directo' : config.smtp.requireTLS ? 'STARTTLS obligatorio' : 'Sin TLS (sólo servidor local)',
    autenticacion: Boolean(config.smtp.user),
    remitente: config.remitente || null,
    dominiosPermitidos: config.dominiosPermitidos,
    maxIntentos: config.maxIntentos,
    problemas: config.problemas,
  };
}

/** Con lista de dominios, sólo esos destinatarios son válidos (piloto controlado). */
export function destinatarioPermitido(config: CorreoConfig, destinatario: string): boolean {
  if (!config.dominiosPermitidos.length) return true;
  const domain = destinatario.split('@').pop()?.toLowerCase() ?? '';
  return config.dominiosPermitidos.includes(domain);
}

/** Esperas entre intentos: 1, 5, 15 y 60 minutos (el último se repite). */
export function esperaReintento(intento: number): number {
  const minutos = [1, 5, 15, 60];
  return minutos[Math.min(intento, minutos.length) - 1] * 60_000;
}
