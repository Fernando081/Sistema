import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { runScheduledJob } from '../common/scheduled-job';
import { leerCorreoConfig } from '../venta/correo-config';
import { EvaluacionArea, MetricasSalidas, NivelSalud, evaluarSalidas, leerUmbrales, nivelGeneral } from './salud-salidas';

export interface SaludSalidas { revisadaEn: string; nivel: NivelSalud; areas: EvaluacionArea[]; metricas: MetricasSalidas; umbrales: ReturnType<typeof leerUmbrales> }

type Fila = Record<string, string | number | null>;
const n = (v: string | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const opt = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

/**
 * O01.3a · Acumulación, capacidad y retención de las salidas. Sólo lee: la vista previa de retención
 * cuenta lo que una política podría liberar, pero nada se elimina (la política la decide el propietario).
 * El job `outputs_health` avisa a los administradores una vez al día por área con problema.
 */
@Injectable()
export class SaludSalidasService {
  private readonly logger = new Logger(SaludSalidasService.name);
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async revisar(): Promise<SaludSalidas> {
    const umbrales = leerUmbrales();
    const [[correo], [reportes], [fiscal], [campanas], [almacen], [retencion]] = await Promise.all([
      queryRows<Fila>(this.db, `SELECT count(*) FILTER (WHERE e.estado IN ('Pendiente','Reintento')) pendientes,
          count(*) FILTER (WHERE e.estado='EnCurso') en_curso, count(*) FILTER (WHERE e.estado='Incierto') inciertos,
          count(*) FILTER (WHERE e.estado='Fallido' AND e.actualizado_en>clock_timestamp()-interval '7 days') fallidos,
          count(*) FILTER (WHERE e.estado='Aceptado' AND e.actualizado_en>clock_timestamp()-interval '7 days') aceptados,
          extract(epoch FROM clock_timestamp()-min(s.creada_en) FILTER (WHERE e.estado IN ('Pendiente','Reintento')))/60 antiguo
        FROM documento_salida_envio e JOIN documento_salida s ON s.id=e.id`),
      queryRows<Fila>(this.db, `SELECT count(*) FILTER (WHERE estado='Pendiente') pendientes, count(*) FILTER (WHERE estado='EnCurso') en_curso,
          count(*) FILTER (WHERE estado='Agotado') agotados,
          count(*) FILTER (WHERE estado='Agotado' AND creada_en>clock_timestamp()-interval '7 days') agotados7,
          extract(epoch FROM clock_timestamp()-min(creada_en) FILTER (WHERE estado='Pendiente'))/60 antiguo
        FROM crm_reporte_reintento`),
      queryRows<Fila>(this.db, `SELECT count(*) FILTER (WHERE estado='Cancelacion solicitada') pendientes,
          count(*) FILTER (WHERE estado='Cancelacion solicitada' AND consultas_estado>=15) sin_respuesta,
          count(*) FILTER (WHERE estado='Error' AND updated_at>clock_timestamp()-interval '7 days') errores,
          extract(epoch FROM clock_timestamp()-min(updated_at) FILTER (WHERE estado='Cancelacion solicitada'))/3600 antiguo
        FROM fiscal_documento`),
      queryRows<Fila>(this.db, `SELECT count(*) FILTER (WHERE e.estado='En curso') en_curso,
          (SELECT count(*) FROM crm_campana_ejecucion_destino d JOIN crm_campana_ejecucion x ON x.id_ejecucion=d.id_ejecucion WHERE x.estado='En curso' AND d.estado='Pendiente') pendientes,
          extract(epoch FROM clock_timestamp()-min(e.creada_en) FILTER (WHERE e.estado='En curso'))/60 antiguo
        FROM crm_campana_ejecucion e`),
      queryRows<Fila>(this.db, `SELECT pg_database_size(current_database()) base, pg_total_relation_size('documento_salida_archivo') pdf,
          (SELECT count(*) FROM documento_salida) documentos, (SELECT count(*) FROM operational_job_run) jobs,
          (SELECT count(*) FROM app_notification) notificaciones`),
      queryRows<Fila>(this.db, `SELECT count(*) pdfs, coalesce(sum(octet_length(a.contenido)),0) bytes,
          (SELECT count(*) FROM operational_job_run WHERE started_at<clock_timestamp()-make_interval(days=>$1)) jobs,
          (SELECT count(*) FROM app_notification WHERE read_at IS NOT NULL AND created_at<clock_timestamp()-make_interval(days=>$1)) leidas
        FROM documento_salida s JOIN documento_salida_archivo a ON a.id=s.id
        LEFT JOIN documento_salida_envio e ON e.id=s.id
        WHERE s.creada_en<clock_timestamp()-make_interval(days=>$1)
          AND (EXISTS(SELECT 1 FROM documento_salida_cierre c WHERE c.id=s.id) OR e.estado IN ('Aceptado','Fallido','Cancelado','Obsoleto'))`, [umbrales.retencionDias]),
    ]);
    const metricas: MetricasSalidas = {
      correo: { modo: leerCorreoConfig().habilitado ? 'smtp' : 'desactivado', pendientes: n(correo.pendientes), enCurso: n(correo.en_curso), inciertos: n(correo.inciertos), fallidos7d: n(correo.fallidos), aceptados7d: n(correo.aceptados), masAntiguoMin: opt(correo.antiguo) },
      reportes: { pendientes: n(reportes.pendientes), enCurso: n(reportes.en_curso), agotados: n(reportes.agotados), agotados7d: n(reportes.agotados7), masAntiguoMin: opt(reportes.antiguo) },
      fiscal: { pendientes: n(fiscal.pendientes), sinRespuesta: n(fiscal.sin_respuesta), errores7d: n(fiscal.errores), masAntiguoHoras: opt(fiscal.antiguo) },
      campanas: { enCurso: n(campanas.en_curso), pendientes: n(campanas.pendientes), masAntiguoMin: opt(campanas.antiguo) },
      almacenamiento: { baseBytes: n(almacen.base), pdfBytes: n(almacen.pdf), documentos: n(almacen.documentos), historialJobs: n(almacen.jobs), notificaciones: n(almacen.notificaciones) },
      retencion: { dias: umbrales.retencionDias, pdfsCerrados: n(retencion.pdfs), pdfBytesCerrados: n(retencion.bytes), historialJobs: n(retencion.jobs), notificacionesLeidas: n(retencion.leidas) },
    };
    const areas = evaluarSalidas(metricas, umbrales);
    return { revisadaEn: new Date().toISOString(), nivel: nivelGeneral(areas), areas, metricas, umbrales };
  }

  @Cron('0 15,45 * * * *')
  async programado() {
    try {
      return await runScheduledJob(this.db, 'outputs_health', async () => { await this.avisar(); }, (m) => this.logger.error(m));
    } catch {
      this.logger.error('Falló la revisión de salud de las salidas');
      return 'failed';
    }
  }

  /** Un aviso por área con problema, por administrador y por día; si empeora a crítico se actualiza. */
  async avisar(): Promise<number> {
    const salud = await this.revisar();
    let enviados = 0;
    for (const area of salud.areas.filter((a) => a.nivel !== 'ok')) {
      const rows = await queryRows<{ id_notification: number }>(this.db,
        `INSERT INTO app_notification(id_user,type,title,message,severity,route,source_type,dedupe_key)
         SELECT u.id_user,'outputs_health',$1,$2,$3,'/dashboard?salidas=1','outputs_health',
                concat('salidas:',$4::text,':',to_char(clock_timestamp() AT TIME ZONE 'America/Mexico_City','YYYY-MM-DD'),':',u.id_user)
           FROM auth_user u WHERE u.is_active AND u.role='admin'
         ON CONFLICT(dedupe_key) DO UPDATE SET severity=excluded.severity,message=excluded.message,read_at=NULL,created_at=clock_timestamp()
          WHERE app_notification.severity<>'critical' AND excluded.severity='critical'
         RETURNING id_notification`,
        [`${area.titulo}: ${area.nivel === 'critico' ? 'requiere acción' : 'requiere revisión'}`, area.mensajes.slice(0, 2).join(' ').slice(0, 500), area.nivel === 'critico' ? 'critical' : 'warning', area.area]);
      enviados += rows.length;
    }
    return enviados;
  }
}
