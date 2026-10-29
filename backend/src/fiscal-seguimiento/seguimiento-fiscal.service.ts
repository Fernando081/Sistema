import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { runScheduledJob } from '../common/scheduled-job';
import { CancellationFollowUp, FiscalService } from '../fiscal/fiscal.service';
import { RegistroRepService } from '../pago/registro-rep.service';
import { ReversionVentaService } from '../venta/reversion-venta.service';

const LOTE = 20;

export interface ResultadoSeguimiento { interrumpidos: number; consultados: number; cancelados: number; rechazados: number; revertidos: number; fallidos: number }

/**
 * O01.2c · Consumidor del PAC: da seguimiento a las cancelaciones que el SAT dejó pendientes.
 * Cuando el SAT confirma, completa la misma reversión que el usuario habría hecho al volver a pulsar
 * "Cancelar" (la pantalla ya prometía revertir al confirmarse). Si el receptor rechaza, avisa y no toca nada.
 */
@Injectable()
export class SeguimientoFiscalService {
  private readonly logger = new Logger(SeguimientoFiscalService.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly fiscal: FiscalService,
    private readonly ventas: ReversionVentaService,
    private readonly reps: RegistroRepService,
  ) {}

  @Cron('0 */5 * * * *')
  async programado() {
    try {
      if (!(await this.hayTrabajoOLatido())) return 'idle';
      return await runScheduledJob(this.db, 'fiscal_followup', async () => { await this.procesar(); }, (m) => this.logger.error(m));
    } catch {
      this.logger.error('Falló el seguimiento de cancelaciones fiscales');
      return 'failed';
    }
  }

  /** Registra ejecución sólo con trabajo pendiente o cada 25 minutos como latido. */
  private async hayTrabajoOLatido(): Promise<boolean> {
    const [row] = await queryRows<{ trabajo: boolean; latido: boolean }>(this.db,
      `SELECT EXISTS(SELECT 1 FROM fiscal_documento WHERE (estado='Cancelacion solicitada' AND proxima_consulta<=clock_timestamp())
                       OR (estado='Procesando' AND ultimo_error IS NULL AND updated_at<clock_timestamp()-interval '15 minutes')) AS trabajo,
              coalesce((SELECT max(finished_at) FROM operational_job_run WHERE job_name='fiscal_followup' AND status='success')
                       < clock_timestamp()-interval '25 minutes', true) AS latido`);
    return Boolean(row?.trabajo || row?.latido);
  }

  async procesar(): Promise<ResultadoSeguimiento> {
    const resultado: ResultadoSeguimiento = { interrumpidos: await this.fiscal.markInterruptedStamps(), consultados: 0, cancelados: 0, rechazados: 0, revertidos: 0, fallidos: 0 };
    // Reserva: aplaza 10 min antes de consultar, así dos procesos no consultan el mismo documento.
    const reservados = await queryRows<{ id_documento: number }>(this.db,
      `UPDATE fiscal_documento SET proxima_consulta=clock_timestamp()+interval '10 minutes'
        WHERE id_documento IN (SELECT id_documento FROM fiscal_documento
                                WHERE estado='Cancelacion solicitada' AND proxima_consulta<=clock_timestamp()
                                ORDER BY proxima_consulta LIMIT ${LOTE} FOR UPDATE SKIP LOCKED)
        RETURNING id_documento`);
    for (const { id_documento } of reservados) {
      const seguimiento = await this.fiscal.followUpCancellation(id_documento);
      if (!seguimiento) continue;
      resultado.consultados++;
      if (seguimiento.result === 'Cancelado') {
        resultado.cancelados++;
        if (await this.revertir(seguimiento)) resultado.revertidos++; else resultado.fallidos++;
      } else if (seguimiento.result === 'Rechazada') {
        resultado.rechazados++;
        await this.avisar(seguimiento, 'warning', 'Cancelación rechazada por el receptor',
          `El receptor rechazó la cancelación de ${this.nombre(seguimiento)}. El CFDI sigue vigente y la operación no se modificó.`);
      } else if (seguimiento.consultas === 15) {
        // Unos 7 días sin respuesta: avisa una vez, sigue consultando cada 12 h.
        await this.avisar(seguimiento, 'warning', 'Cancelación fiscal sin respuesta',
          `La cancelación de ${this.nombre(seguimiento)} sigue pendiente del SAT después de varios días. Se seguirá consultando.`);
      }
    }
    return resultado;
  }

  /** Completa la reversión operativa; si ya se hizo a mano no repite nada. */
  private async revertir(s: CancellationFollowUp): Promise<boolean> {
    const usuario = s.userId ?? undefined;
    try {
      if (s.type === 'FACTURA') {
        const [f] = await queryRows<{ estatus: string }>(this.db, 'SELECT estatus::text AS estatus FROM factura WHERE id_factura=$1', [s.originId]);
        if (f?.estatus !== 'Cancelada') await this.ventas.cancelarFactura(s.originId, usuario);
      } else {
        const [r] = await queryRows<{ estado: string }>(this.db, 'SELECT estado FROM rep WHERE id_rep=$1', [s.originId]);
        if (r?.estado !== 'Cancelado') await this.reps.cancelarRep(s.originId, {}, usuario);
      }
      await this.avisar(s, 'info', 'Cancelación confirmada por el SAT',
        `El SAT confirmó la cancelación de ${this.nombre(s)} y la operación se revirtió automáticamente.`);
      return true;
    } catch (error) {
      const detalle = error instanceof Error ? error.message : 'error desconocido';
      this.logger.error(`El SAT confirmó la cancelación del documento ${s.documentId} pero la reversión falló: ${detalle}`);
      await this.avisar(s, 'critical', 'Cancelación confirmada sin revertir',
        `El SAT confirmó la cancelación de ${this.nombre(s)}, pero la reversión falló (${detalle.slice(0, 160)}). Vuelve a pulsar Cancelar para completarla.`);
      return false;
    }
  }

  private nombre(s: CancellationFollowUp) {
    return s.type === 'FACTURA' ? `la factura ${s.originId}` : `el REP ${s.originId}`;
  }

  /** Avisa a quien pidió la cancelación; si ya no está activo, a los administradores. */
  private async avisar(s: CancellationFollowUp, severidad: 'info' | 'warning' | 'critical', titulo: string, mensaje: string) {
    await this.db.query(
      `INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,source_id,dedupe_key)
       SELECT u.id_user,'fiscal_cancellation',$2,$3,$4,$5,'fiscal_documento',$6::bigint,concat('fiscal-cancelacion:',$6::bigint,':',$7::text,':',u.id_user)
         FROM auth_user u
        WHERE u.is_active AND (u.id_user=$1 OR (u.role='admin' AND NOT EXISTS(SELECT 1 FROM auth_user r WHERE r.id_user=$1 AND r.is_active)))
       ON CONFLICT (dedupe_key) DO NOTHING`,
      [s.userId, titulo, mensaje.slice(0, 500), severidad, s.type === 'FACTURA' ? '/facturas' : '/cobranza', s.documentId, `${titulo}:${s.consultas}`]);
  }
}
