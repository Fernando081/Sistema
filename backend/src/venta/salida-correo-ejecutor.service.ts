import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { runScheduledJob } from '../common/scheduled-job';
import { quoteHash } from '../cotizacion/cotizacion-version-policy';
import { CorreoConfig, esperaReintento, leerCorreoConfig } from './correo-config';
import { CORREO_TRANSPORTE } from './correo-transporte';
import type { CorreoTransporte, ResultadoEnvio } from './correo-transporte';
import { SalidaDocumentosService } from './salida-documentos.service';

interface Reserva { id: string; token: string; intentos: number; maxIntentos: number; messageId: string; folio: string }

export const RESERVA_MINUTOS = 5;
const LOTE = 5;

/**
 * O01.2b · Ejecutor persistente de envíos de documentos por correo.
 * Toma solicitudes en cola con reserva y token, vuelve a validar el documento y envía.
 * Un corte del proceso a mitad del envío deja la reserva vencida: se marca Incierto (nunca se reenvía solo).
 */
@Injectable()
export class SalidaCorreoEjecutorService {
  private readonly logger = new Logger(SalidaCorreoEjecutorService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly salida: SalidaDocumentosService,
    @Inject(CORREO_TRANSPORTE) private readonly transporte: CorreoTransporte,
  ) {}

  @Cron('0 * * * * *')
  async programado() {
    try {
      if (!(await this.hayTrabajoOLatido())) return 'idle';
      return await runScheduledJob(this.db, 'document_mail', async () => { await this.procesar(); }, (m) => this.logger.error(m));
    } catch {
      this.logger.error('Falló el ejecutor de envío de documentos por correo');
      return 'failed';
    }
  }

  /** Registra ejecución sólo si hay algo que hacer o pasaron 9 minutos desde el último éxito (latido). */
  private async hayTrabajoOLatido(): Promise<boolean> {
    const [row] = await queryRows<{ trabajo: boolean; latido: boolean }>(this.db,
      `SELECT EXISTS(SELECT 1 FROM documento_salida_envio WHERE (estado IN ('Pendiente','Reintento') AND proximo_intento<=clock_timestamp())
                       OR (estado='EnCurso' AND reserva_hasta<clock_timestamp())) AS trabajo,
              coalesce((SELECT max(finished_at) FROM operational_job_run WHERE job_name='document_mail' AND status='success')
                       < clock_timestamp()-interval '9 minutes', true) AS latido`);
    return Boolean(row?.trabajo || row?.latido);
  }

  /** Un ciclo: recupera reservas vencidas y procesa hasta LOTE envíos vencidos. Devuelve cuántos intentó. */
  async procesar(config: CorreoConfig = leerCorreoConfig()): Promise<{ vencidas: number; intentados: number }> {
    const vencidas = await this.marcarReservasVencidas();
    // Con la configuración desactivada o inválida las solicitudes esperan en cola; no se pierden ni fallan.
    if (!config.habilitado) return { vencidas, intentados: 0 };
    const reservas = await this.reservar();
    for (const reserva of reservas) {
      try { await this.enviarUno(reserva, config); }
      catch (error) { this.logger.error(`No se pudo procesar el envío ${reserva.id}: ${(error as Error).message}`); }
    }
    return { vencidas, intentados: reservas.length };
  }

  private async marcarReservasVencidas(): Promise<number> {
    return this.db.transaction(async (db) => {
      const rows = await queryRows<{ id: string; intentos: number; desde: Date }>(db,
        // Se leen los valores previos (RETURNING vería reserva_hasta ya en NULL).
        `WITH vencidas AS (
           SELECT id,intentos,reserva_hasta FROM documento_salida_envio
            WHERE estado='EnCurso' AND reserva_hasta<clock_timestamp() FOR UPDATE SKIP LOCKED),
         marcadas AS (
           UPDATE documento_salida_envio e SET estado='Incierto',reserva_token=NULL,reserva_hasta=NULL,actualizado_en=clock_timestamp(),
             ultimo_error='El proceso se interrumpió durante el envío; no se sabe si el servidor lo recibió.'
           FROM vencidas v WHERE e.id=v.id RETURNING e.id)
         SELECT v.id,v.intentos,v.reserva_hasta - interval '${RESERVA_MINUTOS} minutes' AS desde
           FROM vencidas v JOIN marcadas m ON m.id=v.id`);
      for (const r of rows) {
        await db.query(`INSERT INTO documento_salida_intento(id_salida,numero,inicio,resultado,detalle) VALUES($1,$2,$3,'Incierto',$4)
                        ON CONFLICT (id_salida,numero) DO NOTHING`, [r.id, r.intentos, r.desde, 'Reserva vencida sin resultado registrado']);
      }
      return rows.length;
    });
  }

  private reservar(): Promise<Reserva[]> {
    return queryRows<Reserva>(this.db,
      `WITH elegidas AS (
         SELECT id FROM documento_salida_envio WHERE estado IN ('Pendiente','Reintento') AND proximo_intento<=clock_timestamp()
         ORDER BY proximo_intento, id LIMIT $1 FOR UPDATE SKIP LOCKED),
       tomadas AS (
         UPDATE documento_salida_envio e SET estado='EnCurso',reserva_token=gen_random_uuid(),
           reserva_hasta=clock_timestamp()+interval '${RESERVA_MINUTOS} minutes',intentos=e.intentos+1,actualizado_en=clock_timestamp()
         FROM elegidas WHERE e.id=elegidas.id
         RETURNING e.id,e.reserva_token,e.intentos,e.max_intentos,e.message_id)
       SELECT t.id,t.reserva_token AS token,t.intentos,t.max_intentos AS "maxIntentos",t.message_id AS "messageId",
              concat(f.serie,f.folio) AS folio
         FROM tomadas t JOIN documento_salida s ON s.id=t.id JOIN factura f ON f.id_factura=s.id_factura`, [LOTE]);
  }

  private async enviarUno(reserva: Reserva, config: CorreoConfig) {
    const inicio = new Date();
    // 1) Validar con bloqueo: si el documento cambió se cierra Obsoleto y no se envía.
    const mensaje = await this.db.transaction(async (db) => {
      await db.query("SET LOCAL statement_timeout='10s'");
      const [vigente] = await queryRows<{ ok: boolean }>(db,
        `SELECT true AS ok FROM documento_salida_envio WHERE id=$1 AND estado='EnCurso' AND reserva_token=$2 FOR UPDATE`, [reserva.id, reserva.token]);
      if (!vigente) return 'perdida' as const;
      const payload = await this.salida.validarParaEnvio(db, reserva.id);
      if (!payload) {
        await db.query(`UPDATE documento_salida_envio SET estado='Obsoleto',reserva_token=NULL,reserva_hasta=NULL,actualizado_en=clock_timestamp(),
                        ultimo_error='El documento o el destinatario cambiaron después de preparar; no se envió.' WHERE id=$1`, [reserva.id]);
        await this.registrarIntento(db, reserva, inicio, 'Obsoleto', undefined, 'Documento cambiado: no se envió');
        return null;
      }
      return payload;
    });
    if (mensaje === null || mensaje === 'perdida') return;

    // 2) Enviar fuera de la transacción (puede tardar).
    const resultado = await this.transporte.enviar(config, {
      messageId: reserva.messageId,
      para: mensaje.destinatario,
      asunto: mensaje.asunto,
      cuerpo: mensaje.cuerpo,
      adjunto: { nombre: `${reserva.folio || 'documento'}.pdf`, contenido: mensaje.contenido },
    });

    // 3) Registrar el resultado. Si la reserva ya no es nuestra (venció), se conserva el intento pero no se pisa el estado.
    await this.db.transaction(async (db) => {
      const [actual] = await queryRows<{ propia: boolean }>(db,
        `SELECT (estado='EnCurso' AND reserva_token=$2) AS propia FROM documento_salida_envio WHERE id=$1 FOR UPDATE`, [reserva.id, reserva.token]);
      const final = this.decidir(resultado, reserva);
      await this.registrarIntento(db, reserva, inicio, final.intento, final.codigo, final.detalle);
      if (!actual?.propia) return;
      await db.query(
        `UPDATE documento_salida_envio SET estado=$2,reserva_token=NULL,reserva_hasta=NULL,actualizado_en=clock_timestamp(),
           proximo_intento=$3,ultimo_error=$4,respuesta_smtp=coalesce($5,respuesta_smtp) WHERE id=$1`,
        [reserva.id, final.estado, final.proximo, final.estado === 'Aceptado' ? null : final.detalle, resultado.tipo === 'aceptado' ? resultado.respuesta : null]);
      if (final.cierre) {
        await db.query('INSERT INTO documento_salida_cierre(id,request_id,huella,accion,motivo,id_actor)VALUES($1,$2,$3,$4,$5,NULL)',
          [reserva.id, randomUUID(), quoteHash({ id: reserva.id, accion: final.cierre, intento: reserva.intentos }), final.cierre, final.cierre === 'Fallido' ? final.detalle : null]);
      }
    });
  }

  /** Traduce el resultado SMTP a estado de envío, intento y cierre. */
  decidir(resultado: ResultadoEnvio, reserva: Pick<Reserva, 'intentos' | 'maxIntentos'>) {
    if (resultado.tipo === 'aceptado') {
      return { estado: 'Aceptado', intento: 'Aceptado' as const, cierre: 'Aceptado' as const, proximo: null, codigo: resultado.codigo, detalle: resultado.respuesta };
    }
    if (resultado.tipo === 'permanente') {
      return { estado: 'Fallido', intento: 'Fallido' as const, cierre: 'Fallido' as const, proximo: null, codigo: resultado.codigo, detalle: `Rechazado por el servidor: ${resultado.detalle}`.slice(0, 480) };
    }
    if (resultado.tipo === 'incierto') {
      return { estado: 'Incierto', intento: 'Incierto' as const, cierre: null, proximo: null, codigo: resultado.codigo, detalle: `Sin respuesta final del servidor: ${resultado.detalle}`.slice(0, 480) };
    }
    if (reserva.intentos >= reserva.maxIntentos) {
      return { estado: 'Fallido', intento: 'Fallido' as const, cierre: 'Fallido' as const, proximo: null, codigo: resultado.codigo, detalle: `Agotó ${reserva.intentos} intentos: ${resultado.detalle}`.slice(0, 480) };
    }
    return { estado: 'Reintento', intento: 'Reintento' as const, cierre: null, proximo: new Date(Date.now() + esperaReintento(reserva.intentos)), codigo: resultado.codigo, detalle: resultado.detalle.slice(0, 480) };
  }

  private registrarIntento(db: { query: (q: string, p?: unknown[]) => Promise<unknown> }, reserva: Reserva, inicio: Date, resultado: string, codigo: number | undefined, detalle: string) {
    return db.query(`INSERT INTO documento_salida_intento(id_salida,numero,inicio,resultado,codigo_smtp,detalle) VALUES($1,$2,$3,$4,$5,$6)
                     ON CONFLICT (id_salida,numero) DO NOTHING`, [reserva.id, reserva.intentos, inicio, resultado, codigo ?? null, detalle.slice(0, 480)]);
  }
}
