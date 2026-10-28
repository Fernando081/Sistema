import MailComposer from 'nodemailer/lib/mail-composer';
import SMTPConnection from 'nodemailer/lib/smtp-connection';
import { CorreoConfig } from './correo-config';

export interface MensajeCorreo {
  messageId: string;
  para: string;
  asunto: string;
  cuerpo: string;
  adjunto: { nombre: string; contenido: Buffer };
}

/**
 * Resultado clasificado de un intento:
 * - aceptado: el servidor respondió 250 al final del mensaje (no prueba entrega al buzón);
 * - temporal: el servidor no recibió el mensaje (4xx o no se pudo conectar) → se puede reintentar;
 * - permanente: rechazo 5xx → no se reintenta;
 * - incierto: se perdió la conexión o la respuesta después de empezar a enviar el contenido → un humano decide.
 */
export type ResultadoEnvio =
  | { tipo: 'aceptado'; respuesta: string; codigo: number }
  | { tipo: 'temporal' | 'permanente' | 'incierto'; detalle: string; codigo?: number };

export const CORREO_TRANSPORTE = Symbol('CORREO_TRANSPORTE');

export interface CorreoTransporte {
  enviar(config: CorreoConfig, mensaje: MensajeCorreo): Promise<ResultadoEnvio>;
}

/** Comandos SMTP previos al contenido: si fallan sin respuesta, el mensaje seguro no se transmitió. */
const ANTES_DEL_CONTENIDO = new Set(['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH PLAIN', 'AUTH LOGIN', 'AUTH XOAUTH2', 'AUTH CRAM-MD5', 'MAIL FROM', 'RCPT TO']);

interface SmtpError { responseCode?: number; command?: string; code?: string; response?: string; message?: string }

export function clasificarError(error: unknown): ResultadoEnvio {
  const e = (error ?? {}) as SmtpError;
  const detalle = (e.response || e.message || String(error)).replace(/\s+/g, ' ').slice(0, 480);
  // Con código de respuesta el servidor contestó explícitamente: el mensaje no quedó aceptado.
  if (typeof e.responseCode === 'number') {
    if (e.responseCode >= 500) return { tipo: 'permanente', detalle, codigo: e.responseCode };
    if (e.responseCode >= 400) return { tipo: 'temporal', detalle, codigo: e.responseCode };
  }
  if (e.command) return ANTES_DEL_CONTENIDO.has(e.command.toUpperCase()) ? { tipo: 'temporal', detalle } : { tipo: 'incierto', detalle };
  // Sin comando: sólo los errores de conexión/DNS garantizan que no se habló con el servidor.
  if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EDNS'].includes(e.code ?? '')) return { tipo: 'temporal', detalle };
  if (e.code === 'EENVELOPE' || e.code === 'EMESSAGE') return { tipo: 'permanente', detalle };
  // Sin código y después de empezar el contenido (DATA, cierre de conexión, tiempo agotado): no se sabe.
  return { tipo: 'incierto', detalle };
}

/**
 * Usa la conexión SMTP de bajo nivel de nodemailer para saber en qué fase falló:
 * su transporte de alto nivel informa "CONN" incluso si la conexión se cortó después de enviar el contenido.
 */
export class NodemailerTransporte implements CorreoTransporte {
  async enviar(config: CorreoConfig, mensaje: MensajeCorreo): Promise<ResultadoEnvio> {
    const contenido = await new Promise<Buffer>((resolve, reject) =>
      new MailComposer({
        from: config.remitente,
        replyTo: config.responderA,
        to: mensaje.para,
        subject: mensaje.asunto,
        text: mensaje.cuerpo,
        messageId: mensaje.messageId,
        attachments: [{ filename: mensaje.adjunto.nombre, content: mensaje.adjunto.contenido, contentType: 'application/pdf' }],
        disableFileAccess: true,
        disableUrlAccess: true,
      }).compile().build((error, buffer) => (error ? reject(error) : resolve(buffer))));
    const conexion = new SMTPConnection({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      requireTLS: config.smtp.requireTLS,
      tls: { rejectUnauthorized: config.smtp.rejectUnauthorized },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 60_000,
    });
    // La conexión avisa los cortes con eventos ("error"/"end") y entonces no llama al callback pendiente.
    let corte: ((error: unknown) => void) | null = null;
    const alCortar = (error?: unknown) => corte?.(error ?? Object.assign(new Error('La conexión se cerró sin respuesta'), { code: 'ECONNECTION' }));
    conexion.on('error', alCortar);
    conexion.on('end', () => alCortar());
    const paso = <T>(run: (done: (error: unknown, value?: T) => void) => void) =>
      new Promise<T>((resolve, reject) => {
        let terminado = false;
        const done = (error: unknown, value?: T) => { if (terminado) return; terminado = true; corte = null; if (error) reject(error instanceof Error ? error : new Error('Error SMTP sin detalle')); else resolve(value as T); };
        corte = (error) => done(error);
        run(done);
      });
    try {
      // Fase 1: conectar y autenticarse. Si falla, el mensaje seguro no se transmitió.
      try {
        await paso<void>((done) => conexion.connect((error) => done(error)));
        if (config.smtp.user) await paso<void>((done) => conexion.login({ user: config.smtp.user!, pass: config.smtp.pass! }, (error) => done(error)));
      } catch (error) {
        const r = clasificarError(error);
        return r.tipo === 'incierto' ? { tipo: 'temporal', detalle: r.detalle } : r;
      }
      // Fase 2: sobre y contenido. Con respuesta del servidor el resultado es claro; sin ella (corte), incierto.
      try {
        const info = await paso<SMTPConnection.SentMessageInfo>((done) =>
          conexion.send({ from: config.remitente, to: [mensaje.para] }, contenido, (error, value) => done(error, value)));
        const respuesta = String(info?.response ?? '').slice(0, 480);
        if (info?.rejected?.length) return { tipo: 'permanente', detalle: `Destinatario rechazado: ${respuesta}`, codigo: Number(respuesta.slice(0, 3)) || undefined };
        return { tipo: 'aceptado', respuesta, codigo: Number(respuesta.slice(0, 3)) || 250 };
      } catch (error) {
        const e = error as { responseCode?: number; response?: string; message?: string };
        const detalle = (e.response || e.message || String(error)).replace(/\s+/g, ' ').slice(0, 480);
        if (typeof e.responseCode === 'number' && e.responseCode >= 500) return { tipo: 'permanente', detalle, codigo: e.responseCode };
        if (typeof e.responseCode === 'number' && e.responseCode >= 400) return { tipo: 'temporal', detalle, codigo: e.responseCode };
        return { tipo: 'incierto', detalle };
      }
    } finally {
      try { conexion.quit(); } catch { /* conexión ya cerrada */ }
      conexion.close();
    }
  }
}
