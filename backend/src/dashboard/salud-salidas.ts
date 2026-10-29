/**
 * O01.3a · Reglas de salud de las salidas (correo de documentos, recuperación de reportes, cancelaciones
 * fiscales pendientes y simulaciones de campaña) y del almacenamiento que generan. Funciones puras:
 * el servicio consulta las cifras y aquí se decide el nivel y el mensaje para el personal.
 */
export type NivelSalud = 'ok' | 'atencion' | 'critico';
export type AreaSalida = 'correo' | 'reportes' | 'fiscal' | 'campanas' | 'almacenamiento';

export interface MetricasSalidas {
  correo: { modo: 'desactivado' | 'smtp'; pendientes: number; enCurso: number; inciertos: number; fallidos7d: number; aceptados7d: number; masAntiguoMin: number | null };
  reportes: { pendientes: number; enCurso: number; agotados: number; agotados7d: number; masAntiguoMin: number | null };
  fiscal: { pendientes: number; sinRespuesta: number; errores7d: number; masAntiguoHoras: number | null };
  campanas: { enCurso: number; pendientes: number; masAntiguoMin: number | null };
  almacenamiento: { baseBytes: number; pdfBytes: number; documentos: number; historialJobs: number; notificaciones: number };
  retencion: { dias: number; pdfsCerrados: number; pdfBytesCerrados: number; historialJobs: number; notificacionesLeidas: number };
}

export interface UmbralesSalidas { colaMax: number; baseMaxMb: number; pdfMaxMb: number; retencionDias: number }

export interface EvaluacionArea { area: AreaSalida; titulo: string; nivel: NivelSalud; mensajes: string[] }

const TITULOS: Record<AreaSalida, string> = {
  correo: 'Correo de documentos',
  reportes: 'Recuperación de reportes',
  fiscal: 'Cancelaciones fiscales',
  campanas: 'Simulaciones de campaña',
  almacenamiento: 'Almacenamiento',
};

function entero(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined || value.trim() === '' ? fallback : Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function leerUmbrales(env: NodeJS.ProcessEnv = process.env): UmbralesSalidas {
  return {
    colaMax: entero(env.OPERACION_COLA_MAX, 200, 10, 100000),
    baseMaxMb: entero(env.OPERACION_BD_MAX_MB, 4096, 100, 10_000_000),
    pdfMaxMb: entero(env.OPERACION_PDF_MAX_MB, 1024, 10, 10_000_000),
    retencionDias: entero(env.OPERACION_RETENCION_DIAS, 90, 30, 3650),
  };
}

const horas = (min: number) => (min >= 120 ? `${Math.floor(min / 60)} h` : `${Math.round(min)} min`);
const mb = (bytes: number) => Math.round(bytes / 1048576);

export function evaluarSalidas(m: MetricasSalidas, u: UmbralesSalidas): EvaluacionArea[] {
  const areas: EvaluacionArea[] = [];
  const area = (key: AreaSalida, reglas: Array<[boolean, NivelSalud, string]>) => {
    const activas = reglas.filter(([cumple]) => cumple);
    const nivel: NivelSalud = activas.some(([, n]) => n === 'critico') ? 'critico' : activas.length ? 'atencion' : 'ok';
    areas.push({ area: key, titulo: TITULOS[key], nivel, mensajes: activas.sort(([, a], [, b]) => (a === b ? 0 : a === 'critico' ? -1 : 1)).map(([, , texto]) => texto) });
  };
  const c = m.correo;
  area('correo', [
    [c.pendientes > u.colaMax, 'critico', `${c.pendientes} envíos en espera superan el límite de ${u.colaMax}.`],
    [c.modo === 'smtp' && (c.masAntiguoMin ?? 0) > 120, 'critico', `El envío más antiguo lleva ${horas(c.masAntiguoMin ?? 0)} en espera con el correo activo; revisa el servidor de correo.`],
    [c.inciertos > 0, 'atencion', `${c.inciertos} envíos inciertos esperan conciliación en el correo de cada factura (Ventas → Facturas).`],
    [c.fallidos7d > 0, 'atencion', `${c.fallidos7d} envíos fallidos en los últimos 7 días.`],
    [c.modo === 'desactivado' && c.pendientes > 0, 'atencion', `${c.pendientes} envíos esperan, pero el correo está desactivado (MAIL_MODE).`],
  ]);
  const r = m.reportes;
  area('reportes', [
    [r.pendientes > u.colaMax, 'critico', `${r.pendientes} reportes por recuperar superan el límite de ${u.colaMax}.`],
    [r.agotados7d > 0, 'atencion', `${r.agotados7d} reportes agotaron sus intentos en 7 días; revisa la causa en Reportes comerciales.`],
    [(r.masAntiguoMin ?? 0) > 60, 'atencion', `La recuperación más antigua lleva ${horas(r.masAntiguoMin ?? 0)} en espera.`],
  ]);
  const f = m.fiscal;
  area('fiscal', [
    [f.sinRespuesta > 0, 'atencion', `${f.sinRespuesta} cancelaciones llevan días sin respuesta del SAT.`],
    [f.errores7d > 0, 'atencion', `${f.errores7d} documentos fiscales quedaron en Error en 7 días; vuelve a timbrarlos o revisa el PAC.`],
    [(f.masAntiguoHoras ?? 0) > 72 && f.sinRespuesta === 0, 'atencion', `La cancelación pendiente más antigua lleva ${Math.round(f.masAntiguoHoras ?? 0)} h.`],
  ]);
  const k = m.campanas;
  area('campanas', [
    [k.enCurso > 0 && (k.masAntiguoMin ?? 0) > 60, 'atencion', `Una simulación lleva ${horas(k.masAntiguoMin ?? 0)} sin terminar (${k.pendientes} destinatarios pendientes).`],
  ]);
  const a = m.almacenamiento;
  area('almacenamiento', [
    [mb(a.baseBytes) > u.baseMaxMb, 'atencion', `La base ocupa ${mb(a.baseBytes)} MB, más que el aviso de ${u.baseMaxMb} MB.`],
    [mb(a.pdfBytes) > u.pdfMaxMb, 'atencion', `Los PDF conservados de salidas ocupan ${mb(a.pdfBytes)} MB, más que el aviso de ${u.pdfMaxMb} MB.`],
  ]);
  return areas;
}

export function nivelGeneral(areas: EvaluacionArea[]): NivelSalud {
  return areas.some((a) => a.nivel === 'critico') ? 'critico' : areas.some((a) => a.nivel === 'atencion') ? 'atencion' : 'ok';
}
