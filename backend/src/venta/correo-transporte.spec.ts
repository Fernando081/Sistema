import { SmtpLocalPrueba } from '../common/smtp-local-prueba';
import { leerCorreoConfig, destinatarioPermitido, esperaReintento } from './correo-config';
import { clasificarError, NodemailerTransporte } from './correo-transporte';

const mensaje = (n: number) => ({
  messageId: `<salida-${n}@erp.local>`,
  para: 'cliente@example.invalid',
  asunto: 'Documento F10',
  cuerpo: 'Estimado cliente',
  adjunto: { nombre: 'F10.pdf', contenido: Buffer.from('%PDF-1.4 prueba') },
});

describe('Transporte de correo O01.2b (servidor SMTP local real)', () => {
  const smtp = new SmtpLocalPrueba();
  let config: ReturnType<typeof leerCorreoConfig>;
  beforeAll(async () => {
    const port = await smtp.iniciar();
    config = leerCorreoConfig({ MAIL_MODE: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), MAIL_FROM: 'erp@example.invalid' });
  });
  afterAll(() => smtp.detener());

  it('aceptado: 250 y el servidor recibe adjunto y Message-ID fijo', async () => {
    smtp.conducta = () => 'aceptar';
    const r = await new NodemailerTransporte().enviar(config, mensaje(1));
    expect(r).toEqual(expect.objectContaining({ tipo: 'aceptado', codigo: 250 }));
    const recibido = smtp.recibidos.at(-1)!;
    expect(recibido.datos).toContain('Message-ID: <salida-1@erp.local>');
    expect(recibido.datos).toContain('application/pdf');
    expect(recibido.para).toEqual(['<cliente@example.invalid>']);
  });

  it('rechazo 5xx: permanente; 4xx: temporal', async () => {
    smtp.conducta = () => 'rechazar';
    expect(await new NodemailerTransporte().enviar(config, mensaje(2))).toEqual(expect.objectContaining({ tipo: 'permanente', codigo: 550 }));
    smtp.conducta = () => 'temporal';
    expect(await new NodemailerTransporte().enviar(config, mensaje(3))).toEqual(expect.objectContaining({ tipo: 'temporal', codigo: 451 }));
  });

  it('conexión cortada después del contenido: incierto (el servidor sí lo recibió)', async () => {
    smtp.conducta = () => 'cortar-tras-datos';
    const antes = smtp.recibidos.length;
    expect((await new NodemailerTransporte().enviar(config, mensaje(4))).tipo).toBe('incierto');
    expect(smtp.recibidos.length).toBe(antes + 1);
  });

  it('servidor apagado: temporal (nunca se habló con él)', async () => {
    const off = leerCorreoConfig({ MAIL_MODE: 'smtp', SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', MAIL_FROM: 'erp@example.invalid' });
    expect((await new NodemailerTransporte().enviar(off, mensaje(5))).tipo).toBe('temporal');
  });

  it('clasifica errores por comando y código', () => {
    expect(clasificarError({ command: 'RCPT TO', code: 'ESOCKET' }).tipo).toBe('temporal');
    expect(clasificarError({ command: 'DATA', code: 'ETIMEDOUT' }).tipo).toBe('incierto');
    expect(clasificarError({ code: 'ECONNECTION', command: 'CONN' }).tipo).toBe('temporal');
    expect(clasificarError({ code: 'ECONNREFUSED' }).tipo).toBe('temporal');
  });
});

describe('Configuración de correo O01.2b', () => {
  it('desactivada por defecto y valida servidor, remitente y TLS', () => {
    expect(leerCorreoConfig({}).habilitado).toBe(false);
    const sinTls = leerCorreoConfig({ MAIL_MODE: 'smtp', SMTP_HOST: 'smtp.ejemplo.com', MAIL_FROM: 'erp@ejemplo.com' });
    expect(sinTls.habilitado).toBe(false);
    expect(sinTls.problemas.join()).toContain('SMTP_SECURE');
    const ok = leerCorreoConfig({ MAIL_MODE: 'smtp', SMTP_HOST: 'smtp.ejemplo.com', SMTP_REQUIRE_TLS: 'true', MAIL_FROM: 'erp@ejemplo.com', SMTP_USER: 'u', SMTP_PASSWORD: 'p', MAIL_RECIPIENT_DOMAINS: 'example.invalid' });
    expect(ok.habilitado).toBe(true);
    expect(leerCorreoConfig({ MAIL_MODE: 'smtp', SMTP_HOST: 'h', SMTP_REQUIRE_TLS: 'true', MAIL_FROM: 'no es correo' }).problemas.join()).toContain('MAIL_FROM');
    expect(destinatarioPermitido(ok, 'a@example.invalid')).toBe(true);
    expect(destinatarioPermitido(ok, 'a@gmail.com')).toBe(false);
  });

  it('espera creciente entre reintentos', () => {
    expect([1, 2, 3, 4, 5].map((n) => esperaReintento(n) / 60_000)).toEqual([1, 5, 15, 60, 60]);
  });
});
