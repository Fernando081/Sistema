import { createServer, Server, Socket } from 'node:net';

/**
 * Servidor SMTP mínimo SÓLO PARA PRUEBAS (O01.2b): escucha en 127.0.0.1, no reenvía nada y guarda en memoria
 * lo recibido. La aplicación nunca lo usa; lo arrancan las pruebas para tener un transporte real y controlado.
 */
export type ConductaSmtp =
  'aceptar' | 'rechazar' | 'temporal' | 'cortar-tras-datos';

export interface CorreoRecibido {
  de: string;
  para: string[];
  datos: string;
}

export class SmtpLocalPrueba {
  private server?: Server;
  readonly recibidos: CorreoRecibido[] = [];
  private intentos = 0;
  /** Decide la conducta por número de intento (cada MAIL FROM cuenta como uno: 1, 2, ...). */
  conducta: (numero: number) => ConductaSmtp = () => 'aceptar';
  port = 0;

  async iniciar(): Promise<number> {
    this.server = createServer((socket) => this.atender(socket));
    await new Promise<void>((resolve) =>
      this.server!.listen(0, '127.0.0.1', resolve),
    );
    this.port = (this.server.address() as { port: number }).port;
    return this.port;
  }

  async detener(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }

  private atender(socket: Socket) {
    let buffer = '';
    let enDatos = false;
    let de = '';
    let para: string[] = [];
    let datos = '';
    let conducta: ConductaSmtp = 'aceptar';
    let numero = 0;
    const responder = (linea: string) => socket.write(linea + '\r\n');
    responder('220 smtp-local-prueba ESMTP');
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const linea = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (enDatos) {
          if (linea === '.') {
            enDatos = false;
            if (conducta === 'cortar-tras-datos') {
              // El servidor recibió todo pero la respuesta se pierde: el cliente no puede saber el resultado.
              this.recibidos.push({ de, para, datos });
              socket.destroy();
              return;
            }
            if (conducta === 'rechazar') {
              responder('550 5.7.1 Mensaje rechazado por política');
              continue;
            }
            this.recibidos.push({ de, para, datos });
            responder(`250 2.0.0 Ok: aceptado ${numero}`);
          } else
            datos += (linea.startsWith('..') ? linea.slice(1) : linea) + '\r\n';
          continue;
        }
        const cmd = linea.toUpperCase();
        if (cmd.startsWith('EHLO')) {
          socket.write('250-smtp-local-prueba\r\n250 8BITMIME\r\n');
        } else if (cmd.startsWith('HELO')) responder('250 smtp-local-prueba');
        else if (cmd.startsWith('MAIL FROM:')) {
          de = linea.slice(10).trim();
          para = [];
          datos = '';
          numero = ++this.intentos;
          conducta = this.conducta(numero);
          responder('250 2.1.0 Ok');
        } else if (cmd.startsWith('RCPT TO:')) {
          if (conducta === 'temporal') {
            responder('451 4.3.0 Intenta más tarde');
            continue;
          }
          para.push(linea.slice(8).trim());
          responder('250 2.1.5 Ok');
        } else if (cmd === 'DATA') {
          enDatos = true;
          responder('354 Termina con <CR><LF>.<CR><LF>');
        } else if (cmd === 'RSET') {
          de = '';
          para = [];
          datos = '';
          responder('250 Ok');
        } else if (cmd === 'QUIT') {
          responder('221 Adiós');
          socket.end();
        } else if (cmd === 'NOOP') responder('250 Ok');
        else responder('502 5.5.2 No implementado');
      }
    });
  }
}
