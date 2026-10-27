import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { QueryExecutor, queryRows, readSnapshot } from '../common/database/typed-query';
import { CrmBandejaQuery } from './crm-bandeja.dto';
export interface BandejaItem {
  id: string; tipo: 'tarea' | 'oportunidad' | 'cotizacion' | 'web';
  titulo: string; cuenta: string | null; responsable: string | null;
  estado: string; fecha: string | null; plazo: string;
}
export interface BandejaResult {
  data: BandejaItem[]; total: number; page: number; limit: number;
  consultadoEn: string; zonaHoraria: string; administrador: boolean;
  resumen: { vencidas: number; hoy: number; proximas: number; sinFecha: number };
}
// Una fila por origen. Consultar no crea avisos ni atiende asuntos.
@Injectable()
export class CrmBandejaService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}
  list(q: CrmBandejaQuery, actor: JwtPayload): Promise<BandejaResult> {
    return readSnapshot(this.db, db => this.inSnapshot(q, actor, db));
  }
  async inSnapshot(q: CrmBandejaQuery, actor: JwtPayload, db: QueryExecutor): Promise<BandejaResult> {
      await db.query("SET LOCAL statement_timeout='8s'");
      const [account] = await queryRows<{ role: string }>(db,
        'SELECT role FROM auth_user WHERE id_user=$1 AND is_active AND role=$2 AND token_version=$3',
        [actor.idUser, actor.role, actor.version]);
      if (!account || !['admin', 'user'].includes(account.role)) throw new ForbiddenException('La cuenta cambió; vuelve a iniciar sesión.');
      const admin = account.role === 'admin';
      if (!admin && ['cotizacion', 'web'].includes(q.tipo)) throw new ForbiddenException('Esta fuente requiere administración.');
      const [result] = await queryRows<Omit<BandejaResult, 'page' | 'limit' | 'zonaHoraria' | 'administrador'>>(db, `
        WITH contexto AS (SELECT statement_timestamp() AS ahora), origen AS (
          SELECT t.id_tarea::text AS id,'tarea'::text AS tipo,t.titulo,
            c."RazonSocial"::text AS cuenta,u.username::text AS responsable,t.estado,t.fecha_vencimiento AS fecha
          FROM crm_tarea t LEFT JOIN cliente c ON c."IdCliente"=t.id_cliente LEFT JOIN auth_user u ON u.id_user=t.id_responsable
          WHERE ($1::boolean OR t.id_responsable=$2 OR t.id_creador=$2) AND t.estado IN ('Pendiente','En progreso')
            AND NOT EXISTS(SELECT 1 FROM crm_secuencia s WHERE s.id_secuencia=t.id_secuencia AND s.estado='Pausada')
          UNION ALL
          SELECT o.id_oportunidad::text,'oportunidad',coalesce(nullif(o.siguiente_accion,''),'Definir siguiente acción'),
            o.empresa,u.username,o.etapa,o.fecha_siguiente_accion
          FROM crm_oportunidad o LEFT JOIN auth_user u ON u.id_user=o.id_responsable
          WHERE ($1::boolean OR o.id_responsable=$2) AND o.etapa NOT IN ('Ganada','Perdida')
          UNION ALL
          SELECT c.id_cotizacion::text,'cotizacion',concat('Cotización ',c.folio),c.nombre_receptor,
            NULL::text,c.estatus::text,c.fecha_vencimiento
          FROM cotizacion c WHERE $1::boolean AND c.estatus IN ('Pendiente','Vigente')
          UNION ALL
          SELECT w.request_id::text,'web','Revisar solicitud web',NULL::text,NULL::text,w.estado,w.expires_at
          FROM crm_solicitud_web w CROSS JOIN contexto x
          WHERE $1::boolean AND w.estado IN ('Pendiente','Revisada') AND w.id_oportunidad IS NULL
            AND w.payload IS NOT NULL AND w.expires_at>x.ahora
        ), clasificado AS (
          SELECT o.*,CASE WHEN fecha IS NULL THEN 'sin-fecha' WHEN fecha<x.ahora THEN 'vencidas'
            WHEN (fecha AT TIME ZONE 'America/Mexico_City')::date=(x.ahora AT TIME ZONE 'America/Mexico_City')::date THEN 'hoy'
            WHEN fecha<x.ahora+interval '7 days' THEN 'proximas' ELSE 'posteriores' END AS plazo
          FROM origen o CROSS JOIN contexto x WHERE ($3::text='todos' OR tipo=$3)
            AND concat_ws(' ',id,titulo,cuenta,responsable) ILIKE $4 ESCAPE '\\'
        ), filtrado AS MATERIALIZED (
          SELECT * FROM clasificado WHERE $5::text='todos' OR plazo=$5
        ), pagina AS (
          SELECT * FROM filtrado ORDER BY CASE plazo WHEN 'vencidas' THEN 0 WHEN 'hoy' THEN 1 WHEN 'sin-fecha' THEN 2 ELSE 3 END,
            fecha ASC NULLS LAST,tipo,id LIMIT 20 OFFSET $6
        ) SELECT coalesce((SELECT jsonb_agg(p ORDER BY
            CASE plazo WHEN 'vencidas' THEN 0 WHEN 'hoy' THEN 1 WHEN 'sin-fecha' THEN 2 ELSE 3 END,
            fecha ASC NULLS LAST,tipo,id) FROM pagina p),'[]'::jsonb) AS data,
          count(*)::int AS total,jsonb_build_object('vencidas',count(*) FILTER(WHERE plazo='vencidas'),
            'hoy',count(*) FILTER(WHERE plazo='hoy'),'proximas',count(*) FILTER(WHERE plazo='proximas'),
            'sinFecha',count(*) FILTER(WHERE plazo='sin-fecha')) AS resumen,
          (SELECT ahora FROM contexto) AS "consultadoEn" FROM filtrado`,
        [admin, actor.idUser, q.tipo, `%${q.q.replace(/[\\%_]/g, '\\$&')}%`, q.plazo, (q.page - 1) * 20]);
      return { ...result, page: q.page, limit: 20, zonaHoraria: 'America/Mexico_City', administrador: admin };
  }
}
