import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { IsString, Matches } from 'class-validator';
import { DataSource } from 'typeorm';
import { queryRows, readSnapshot } from '../common/database/typed-query';
import { commercialSalesCtes, WebCommercialMetrics } from './crm-commercial-query';
import { WebFinancialMetrics, webFinanceCtes, webFinanceProjection, webFinancialCurrencies } from './crm-web-finance-query';

export class WebMetricsQuery {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) desde: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) hasta: string;
}

export interface WebMetricsTotals {
  recibidas: number; pendientes: number; revisadasSinOportunidad: number; descartadas: number;
  oportunidades: number; abiertasCrm: number; ganadasCrm: number; perdidasCrm: number;
  vigentes: number; vencidas: number; purgadas: number;
  piezasVigentes: number; piezasSnapshot: number; sinPiezas: number;
}
export interface WebMetrics {
  source: 'crm-local'; generatedAt: string;
  period: { desde: string; hasta: string; timezone: 'America/Mexico_City'; days: number };
  totals: WebMetricsTotals; conversionPct: number | null;
  daily: { fecha: string; recibidas: number; oportunidades: number }[];
  references: { code: string; brand: string; solicitudes: number; cantidad: number }[];
  commercial: WebCommercialMetrics;
  finance: WebFinancialMetrics;
  unmeasured: string[];
}

export function validateWebMetricsPeriod(desde: string, hasta: string): number {
  const day = (value: string) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const parsed = Date.parse(value + 'T00:00:00Z');
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
      && value >= '2000-01-01' && value <= '2099-12-31' ? parsed : NaN;
  };
  const first = day(desde), last = day(hasta);
  const days = (last - first) / 86400000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > 366)
    throw new BadRequestException('Elige fechas válidas, en orden, entre 2000 y 2099 y un intervalo de hasta 366 días.');
  return days;
}

// A cohort is selected by receipt date. Its state and linked CRM stage are observed
// now, not events or sales occurring within that period. No contacts are projected.
const metricsSql = `WITH bounds AS (
  SELECT ($1::date::timestamp AT TIME ZONE 'America/Mexico_City') AS inicio,
    (($2::date + 1)::timestamp AT TIME ZONE 'America/Mexico_City') AS fin,
    transaction_timestamp() AS observado
), cohort AS MATERIALIZED (
  SELECT w.request_id,w.estado,w.id_oportunidad,o.etapa,
    (w.created_at AT TIME ZONE 'America/Mexico_City')::date AS fecha,
    CASE WHEN w.payload IS NULL THEN 'Purgado'
      WHEN w.expires_at<=b.observado THEN 'Vencido' ELSE 'Vigente' END AS contenido,
    CASE WHEN w.payload IS NOT NULL AND w.expires_at>b.observado THEN w.payload->'items'
      WHEN w.id_oportunidad IS NOT NULL THEN s.piezas ELSE NULL END AS piezas,
    CASE WHEN w.payload IS NOT NULL AND w.expires_at>b.observado THEN 'Vigente'
      WHEN w.id_oportunidad IS NOT NULL AND s.piezas IS NOT NULL THEN 'Snapshot' ELSE 'Ninguna' END AS fuente
  FROM crm_solicitud_web w CROSS JOIN bounds b
  LEFT JOIN crm_oportunidad o ON o.id_oportunidad=w.id_oportunidad
  LEFT JOIN crm_oportunidad_consulta_web s ON s.id_oportunidad=w.id_oportunidad AND s.request_id=w.request_id
  WHERE w.created_at>=b.inicio AND w.created_at<b.fin
), linked_quotes AS MATERIALIZED (
  SELECT m.* FROM crm_oportunidad_cotizacion m JOIN cohort c ON c.id_oportunidad=m.id_oportunidad
), ${commercialSalesCtes}, ${webFinanceCtes}, safe_pieces AS MATERIALIZED (
  SELECT *,CASE WHEN jsonb_typeof(piezas)='array' THEN
    CASE WHEN jsonb_array_length(piezas) BETWEEN 1 AND 10 THEN piezas ELSE '[]'::jsonb END
    ELSE '[]'::jsonb END AS lista FROM cohort
), items AS (
  SELECT c.request_id,btrim(p.item->>'code') AS code,COALESCE(btrim(p.item->>'brand'),'') AS brand,
    CASE WHEN jsonb_typeof(p.item->'quantity')='number' AND (p.item->>'quantity') ~ '^[1-9][0-9]{0,3}$'
      THEN (p.item->>'quantity')::integer ELSE NULL END AS cantidad
  FROM safe_pieces c CROSS JOIN LATERAL jsonb_array_elements(c.lista) AS p(item)
  WHERE jsonb_typeof(p.item->'code')='string' AND length(btrim(p.item->>'code')) BETWEEN 1 AND 100
    AND (p.item->'brand' IS NULL OR jsonb_typeof(p.item->'brand')='string')
    AND length(COALESCE(p.item->>'brand',''))<=100
), references_top AS (
  SELECT code,brand,count(DISTINCT request_id)::int AS solicitudes,sum(cantidad)::bigint AS cantidad
  FROM items WHERE cantidad IS NOT NULL GROUP BY code,brand
  ORDER BY solicitudes DESC,cantidad DESC,code COLLATE "C",brand COLLATE "C" LIMIT 10
), daily_counts AS (
  SELECT fecha,count(*)::int AS recibidas,count(*) FILTER (WHERE id_oportunidad IS NOT NULL)::int AS oportunidades
  FROM cohort GROUP BY fecha
), daily AS (
  SELECT d.fecha::date::text AS fecha,COALESCE(c.recibidas,0) AS recibidas,COALESCE(c.oportunidades,0) AS oportunidades
  FROM generate_series($1::date::timestamp,$2::date::timestamp,interval '1 day') d(fecha)
  LEFT JOIN daily_counts c ON c.fecha=d.fecha::date ORDER BY d.fecha
)
SELECT transaction_timestamp() AS "generatedAt",
  ${webFinanceProjection},
  json_build_object(
    'cotizacionesVinculadas',(SELECT count(*)::int FROM linked_quotes),
    'solicitudesConCotizacion',(SELECT count(DISTINCT id_oportunidad)::int FROM linked_quotes),
    'solicitudesConVenta',(SELECT count(DISTINCT id_oportunidad)::int FROM valid_sales),
    'documentosVentaVigentes',(SELECT count(DISTINCT id_factura)::int FROM valid_sales),
    'documentosCancelados',(SELECT count(DISTINCT id_factura)::int FROM sale_links WHERE coherent AND cancelled),
    'documentosInconsistentes',(SELECT count(DISTINCT id_factura)::int FROM sale_links WHERE NOT coherent)
  ) AS commercial,
  (SELECT json_build_object(
    'recibidas',count(*),
    'pendientes',count(*) FILTER (WHERE id_oportunidad IS NULL AND estado='Pendiente'),
    'revisadasSinOportunidad',count(*) FILTER (WHERE id_oportunidad IS NULL AND estado='Revisada'),
    'descartadas',count(*) FILTER (WHERE id_oportunidad IS NULL AND estado='Descartada'),
    'oportunidades',count(*) FILTER (WHERE id_oportunidad IS NOT NULL),
    'abiertasCrm',count(*) FILTER (WHERE id_oportunidad IS NOT NULL AND etapa NOT IN ('Ganada','Perdida')),
    'ganadasCrm',count(*) FILTER (WHERE etapa='Ganada'),
    'perdidasCrm',count(*) FILTER (WHERE etapa='Perdida'),
    'vigentes',count(*) FILTER (WHERE contenido='Vigente'),
    'vencidas',count(*) FILTER (WHERE contenido='Vencido'),
    'purgadas',count(*) FILTER (WHERE contenido='Purgado'),
    'piezasVigentes',count(*) FILTER (WHERE fuente='Vigente' AND jsonb_array_length(lista)>0),
    'piezasSnapshot',count(*) FILTER (WHERE fuente='Snapshot' AND jsonb_array_length(lista)>0),
    'sinPiezas',count(*) FILTER (WHERE jsonb_array_length(lista)=0)
  ) FROM safe_pieces) AS totals,
  (SELECT COALESCE(json_agg(daily ORDER BY fecha),'[]'::json) FROM daily) AS daily,
  (SELECT COALESCE(json_agg(references_top ORDER BY solicitudes DESC,cantidad DESC,code COLLATE "C",brand COLLATE "C"),'[]'::json)
    FROM references_top) AS "references"`;

@Injectable()
export class CrmWebMetricsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async report(desde: string, hasta: string): Promise<WebMetrics> {
    const days = validateWebMetricsPeriod(desde, hasta);
    return readSnapshot(this.db, async source => {
      await source.query("SET LOCAL statement_timeout='5s'");
      const [row] = await queryRows<{ generatedAt: Date; totals: WebMetricsTotals;
        daily: WebMetrics['daily']; references: WebMetrics['references']; commercial: WebCommercialMetrics;
        finance: WebFinancialMetrics }>(source, metricsSql, [desde, hasta, webFinancialCurrencies]);
      return { ...row, source: 'crm-local', generatedAt: row.generatedAt.toISOString(),
        period: { desde, hasta, timezone: 'America/Mexico_City', days },
        // Avoid presenting an undefined denominator as a zero conversion rate.
        conversionPct: row.totals.recibidas ? Math.round(row.totals.oportunidades / row.totals.recibidas * 10000) / 100 : null,
        unmeasured: ['vistas', 'busquedas', 'clicsCotizacion', 'clicsWhatsApp', 'busquedasSinResultado',
          'ventasSinVinculo', 'flujoIntegral'],
      };
    });
  }
}
