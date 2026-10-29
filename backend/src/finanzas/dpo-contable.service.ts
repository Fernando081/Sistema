import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { businessDate } from '../common/business-date';
import { QueryExecutor, queryRows, readSnapshot } from '../common/database/typed-query';

const money = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000) + 1;
const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Días por pagar = saldo medio / flujo del periodo × días. Null si el denominador no es positivo. */
export function diasPorPagar(saldoMedio: number, flujo: number, dias: number): number | null {
  if (!(flujo > 0) || !(dias > 0)) return null;
  return Math.round((saldoMedio / flujo) * dias * 10) / 10;
}

/**
 * F03 · DPO contable (días de pago a proveedores) desde el libro mayor, separado del "plazo efectivo" operativo de Q02.
 * - Saldo medio: promedio de los saldos de cierre diarios de Proveedores (2100) en el periodo.
 * - DPO sobre costo de ventas (5000) y DPO sobre compras a crédito (abonos a 2100 por facturas/compras).
 * - Conciliaciones: mayor 2100 contra el auxiliar de proveedores (al día de hoy) e inventario 1130 contra costo de ventas.
 * Sólo lee pólizas contabilizadas; no corrige nada. Las diferencias se explican para la revisión contable (F02).
 */
@Injectable()
export class DpoContableService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  calcular(fechaInicio?: string, fechaFin?: string) {
    const fin = fechaFin || businessDate();
    const inicio = fechaInicio || addDays(fin, -89);
    if (inicio > fin) throw new BadRequestException('La fecha inicial no puede ser posterior a la final');
    const dias = days(inicio, fin);
    if (dias > 731) throw new BadRequestException('El periodo máximo es de dos años');
    return readSnapshot(this.dataSource, (db) => this.leer(db, inicio, fin, dias));
  }

  private async leer(db: QueryExecutor, inicio: string, fin: string, dias: number) {
    const movimientos = `FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza
      JOIN cuenta_contable c ON c.id_cuenta=d.id_cuenta WHERE p.estado='Contabilizada'`;
    // Saldo acreedor de 2100 al cierre de cada día del periodo (saldo inicial + movimientos acumulados).
    const [ap] = await queryRows<{ inicial: string; final: string; medio: string; minimo: string; primera: string | null }>(db, `
      WITH inicial AS (SELECT coalesce(sum(d.haber-d.debe),0) AS saldo ${movimientos} AND c.codigo='2100' AND p.fecha<$1::date),
      diario AS (SELECT p.fecha, sum(d.haber-d.debe) AS neto ${movimientos} AND c.codigo='2100' AND p.fecha BETWEEN $1::date AND $2::date GROUP BY p.fecha),
      serie AS (SELECT g::date AS dia FROM generate_series($1::date,$2::date,interval '1 day') g),
      saldos AS (SELECT s.dia,(SELECT saldo FROM inicial)+coalesce(sum(coalesce(x.neto,0)) OVER (ORDER BY s.dia),0) AS saldo
                   FROM serie s LEFT JOIN diario x ON x.fecha=s.dia)
      SELECT (SELECT saldo FROM inicial) AS inicial,
             (SELECT saldo FROM saldos ORDER BY dia DESC LIMIT 1) AS final,
             avg(saldo) AS medio, min(saldo) AS minimo,
             (SELECT min(p.fecha)::text ${movimientos}) AS primera
        FROM saldos`, [inicio, fin]);
    const flujos = await queryRows<{ codigo: string; origen: string; debe: string; haber: string }>(db, `
      SELECT c.codigo, coalesce(p.origen_tipo,'Manual') AS origen, sum(d.debe) AS debe, sum(d.haber) AS haber
      ${movimientos} AND c.codigo IN ('2100','1130','5000') AND p.fecha BETWEEN $1::date AND $2::date GROUP BY 1,2 ORDER BY 1,2`, [inicio, fin]);
    const [inv] = await queryRows<{ inicial: string; final: string }>(db, `
      SELECT coalesce(sum(CASE WHEN p.fecha<$1::date THEN d.debe-d.haber END),0) AS inicial,
             coalesce(sum(CASE WHEN p.fecha<=$2::date THEN d.debe-d.haber END),0) AS final
      ${movimientos} AND c.codigo='1130'`, [inicio, fin]);
    const sum = (codigo: string, col: 'debe' | 'haber', origenes?: string[]) =>
      money(flujos.filter((f) => f.codigo === codigo && (!origenes || origenes.includes(f.origen))).reduce((s, f) => s + Number(f[col]), 0));

    const saldoMedio = money(Number(ap.medio));
    const costoVentas = money(sum('5000', 'debe') - sum('5000', 'haber'));
    // Compras a crédito: abonos a Proveedores originados por facturas de proveedor o compras del modelo anterior.
    const compras = sum('2100', 'haber', ['FacturaProveedor', 'Compra']);
    const pagos = sum('2100', 'debe');
    const otrosAbonos = money(sum('2100', 'haber') - compras);
    const entradasInventario = sum('1130', 'debe');
    const salidasInventario = sum('1130', 'haber');

    const advertencias: string[] = [];
    const conciliacionProveedores = await this.conciliarProveedores(db, fin, money(Number(ap.final)));
    if (conciliacionProveedores.aplica && Math.abs(conciliacionProveedores.diferencia) >= 0.01) {
      advertencias.push(`El saldo contable de Proveedores difiere del auxiliar por ${conciliacionProveedores.diferencia.toFixed(2)}; el DPO usa el saldo contable y no es confiable hasta corregirlo.`);
    }
    if (ap.primera && ap.primera > inicio) advertencias.push(`La contabilidad inicia el ${ap.primera}; los días anteriores del periodo cuentan con saldo cero.`);
    if (Number(ap.minimo) < -0.005) advertencias.push('Proveedores tuvo saldo deudor algún día del periodo (pagos o anticipos mayores que las facturas registradas).');
    if (costoVentas <= 0) advertencias.push('Sin costo de ventas en el periodo: el DPO sobre costo no se puede calcular.');
    if (compras <= 0) advertencias.push('Sin compras a crédito registradas en el periodo: el DPO sobre compras no se puede calcular.');
    const diferenciaCosto = money(salidasInventario - costoVentas);
    if (Math.abs(diferenciaCosto) >= 0.01) advertencias.push(`Las salidas de inventario y el costo de ventas difieren por ${diferenciaCosto.toFixed(2)} (ajustes, mermas o pólizas manuales).`);

    const [plazo] = await queryRows<{ v: string | null }>(db, 'SELECT fn_plazo_pago_proveedores_90d() AS v');
    return {
      periodo: { inicio, fin, dias },
      proveedores: { saldoInicial: money(Number(ap.inicial)), saldoFinal: money(Number(ap.final)), saldoMedio, compras, pagos, otrosAbonos },
      costoVentas,
      dpoCosto: diasPorPagar(saldoMedio, costoVentas, dias),
      dpoCompras: diasPorPagar(saldoMedio, compras, dias),
      conciliacionProveedores,
      conciliacionInventario: {
        saldoInicial: money(Number(inv.inicial)), entradas: entradasInventario, salidas: salidasInventario,
        saldoFinal: money(Number(inv.final)), costoVentas, diferenciaSalidasCosto: diferenciaCosto,
      },
      movimientos: flujos.map((f) => ({ cuenta: f.codigo, origen: f.origen, debe: money(Number(f.debe)), haber: money(Number(f.haber)) })),
      // Métrica operativa distinta (Q02): días ponderados por monto entre factura y pago, últimos 90 días.
      plazoEfectivoOperativo: plazo?.v === null || plazo?.v === undefined ? null : Math.round(Number(plazo.v) * 10) / 10,
      advertencias,
    };
  }

  /**
   * Compara el mayor 2100 con el auxiliar: saldos pendientes de facturas de proveedor vigentes y de compras anteriores.
   * El auxiliar sólo existe "hoy", así que la comparación aplica cuando el periodo termina hoy.
   * Una compra cuyo ajuste F02 ya se contabilizó deja de contarse como causa.
   */
  private async conciliarProveedores(db: QueryExecutor, fin: string, mayor: number) {
    if (fin !== businessDate()) {
      return { aplica: false, motivo: 'El auxiliar de proveedores sólo se conoce al día de hoy; elige un periodo que termine hoy para conciliar.', mayor, auxiliar: null, diferencia: 0, partidas: [] };
    }
    const [aux] = await queryRows<{ facturas: string; anteriores: string; anticipos: string; contadoSinPago: string; contadoN: number }>(db, `
      SELECT (SELECT coalesce(sum(saldo_pendiente*tipo_cambio),0) FROM factura_proveedor WHERE estado IN ('Aprobada','Parcialmente pagada')) AS facturas,
             (SELECT coalesce(sum(saldo_pendiente),0) FROM compra WHERE estatus::text NOT IN ('Cancelada','Cancelado')) AS anteriores,
             (SELECT coalesce(sum(saldo_disponible),0) FROM anticipo_proveedor WHERE estado<>'Cancelado') AS anticipos,
             (SELECT coalesce(sum(c.total),0) FROM compra c WHERE c.estatus::text NOT IN ('Cancelada','Cancelado') AND c.saldo_pendiente=0
                AND NOT EXISTS (SELECT 1 FROM pago_proveedor pp WHERE pp.id_compra=c.id_compra)
                AND NOT EXISTS (SELECT 1 FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza
                                 WHERE p.estado='Contabilizada' AND d.referencia='F02:compra:'||c.id_compra)) AS "contadoSinPago",
             (SELECT count(*)::int FROM compra c WHERE c.estatus::text NOT IN ('Cancelada','Cancelado') AND c.saldo_pendiente=0
                AND NOT EXISTS (SELECT 1 FROM pago_proveedor pp WHERE pp.id_compra=c.id_compra)
                AND NOT EXISTS (SELECT 1 FROM poliza_contable_detalle d JOIN poliza_contable p ON p.id_poliza=d.id_poliza
                                 WHERE p.estado='Contabilizada' AND d.referencia='F02:compra:'||c.id_compra)) AS "contadoN"`);
    const facturas = money(Number(aux.facturas));
    const anteriores = money(Number(aux.anteriores));
    const auxiliar = money(facturas + anteriores);
    const diferencia = money(mayor - auxiliar);
    const contadoSinPago = money(Number(aux.contadoSinPago));
    const partidas = [
      { concepto: 'Facturas de proveedor por pagar', importe: facturas },
      { concepto: 'Compras anteriores por pagar', importe: anteriores },
    ];
    const causas: string[] = [];
    if (contadoSinPago >= 0.01) {
      causas.push(`${aux.contadoN} compra(s) anteriores ya liquidadas sin pago registrado en contabilidad (de contado) suman ${contadoSinPago.toFixed(2)}: su póliza abonó Proveedores y nunca se cargó el pago.`);
    }
    if (Number(aux.anticipos) >= 0.01) causas.push(`Hay anticipos disponibles por ${money(Number(aux.anticipos)).toFixed(2)} registrados en su propia cuenta (1150), no en Proveedores.`);
    return {
      aplica: true, motivo: null, mayor, auxiliar, diferencia, partidas,
      diferenciaExplicada: Math.abs(diferencia - contadoSinPago) < 0.01 && contadoSinPago >= 0.01,
      causas,
    };
  }
}
