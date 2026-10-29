import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QueryExecutor, queryRows } from '../common/database/typed-query';

/** Referencia que liga cada cargo del ajuste con su compra; también la usa F03 para dejar de contarla como causa. */
export const REFERENCIA_F02 = 'F02:compra:';

export interface CompraSinPago { idCompra: number; fecha: string; proveedor: string; total: number; abonoProveedores: number; folioPoliza: number | null }
export interface AjusteExistente { idPoliza: number; folio: number; fecha: string; estado: 'Borrador' | 'Contabilizada'; total: number; compras: number[] }

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * F02a · Propuesta de ajuste de Proveedores (2100) por compras anteriores de contado que el modelo previo
 * abonó a Proveedores sin registrar su pago (hallazgo F03). Sólo prepara una póliza manual en **Borrador**:
 * la cuenta de contrapartida, la fecha y la decisión de contabilizarla corresponden al contador.
 */
@Injectable()
export class AjusteProveedoresService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /** Compras liquidadas sin pago contable, con el abono a 2100 de su póliza automática contabilizada. */
  private pendientes(db: QueryExecutor) {
    return queryRows<{ id_compra: number; fecha: string; proveedor: string; total: string; abono: string; folio: string | null }>(db, `
      SELECT c.id_compra, c.fecha_compra::date::text AS fecha, coalesce(pr."RazonSocial", 'Proveedor ' || c.id_proveedor) AS proveedor, c.total,
             coalesce(a.abono, 0) AS abono, a.folio
        FROM compra c
        LEFT JOIN proveedor pr ON pr."IdProveedor" = c.id_proveedor
        LEFT JOIN LATERAL (
          SELECT sum(d.haber) AS abono, min(p.folio) AS folio
            FROM poliza_contable p JOIN poliza_contable_detalle d ON d.id_poliza = p.id_poliza
            JOIN cuenta_contable cc ON cc.id_cuenta = d.id_cuenta AND cc.codigo = '2100'
           WHERE p.origen_tipo = 'Compra' AND p.origen_id = c.id_compra AND p.estado = 'Contabilizada') a ON true
       WHERE c.estatus::text NOT IN ('Cancelada', 'Cancelado') AND c.saldo_pendiente = 0
         AND NOT EXISTS (SELECT 1 FROM pago_proveedor pp WHERE pp.id_compra = c.id_compra)
         AND coalesce(a.abono, 0) > 0
       ORDER BY c.fecha_compra, c.id_compra`);
  }

  private ajustes(db: QueryExecutor) {
    return queryRows<{ id_poliza: string; folio: string; fecha: string; estado: 'Borrador' | 'Contabilizada'; total: string; compras: number[] }>(db, `
      SELECT p.id_poliza, p.folio, p.fecha::text AS fecha, p.estado, sum(d.debe) AS total,
             array_agg(substring(d.referencia FROM ${REFERENCIA_F02.length + 1})::int ORDER BY d.id_detalle) AS compras
        FROM poliza_contable p JOIN poliza_contable_detalle d ON d.id_poliza = p.id_poliza
       WHERE p.estado <> 'Cancelada' AND NOT p.automatica AND d.referencia LIKE '${REFERENCIA_F02}%' AND d.debe > 0
       GROUP BY p.id_poliza ORDER BY p.id_poliza`);
  }

  async propuesta() {
    const [rows, ajustes] = await Promise.all([this.pendientes(this.db), this.ajustes(this.db)]);
    const cubiertas = new Set(ajustes.flatMap((a) => a.compras));
    const compras: CompraSinPago[] = rows.map((r) => ({ idCompra: r.id_compra, fecha: r.fecha, proveedor: r.proveedor, total: money(Number(r.total)), abonoProveedores: money(Number(r.abono)), folioPoliza: r.folio === null ? null : Number(r.folio) }));
    const sinAjuste = compras.filter((c) => !cubiertas.has(c.idCompra));
    return {
      compras: sinAjuste,
      total: money(sinAjuste.reduce((s, c) => s + c.abonoProveedores, 0)),
      ajustes: ajustes.map<AjusteExistente>((a) => ({ idPoliza: Number(a.id_poliza), folio: Number(a.folio), fecha: a.fecha, estado: a.estado, total: money(Number(a.total)), compras: a.compras })),
    };
  }

  /** Crea la póliza en Borrador con un cargo a 2100 por compra y un abono total a la contrapartida elegida. */
  async crear(dto: { fecha: string; idCuentaContrapartida: number; motivo: string; compras: number[] }, idUsuario?: number) {
    return this.db.transaction(async (manager) => {
      await manager.query("SET LOCAL lock_timeout='5s'");
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('f02-ajuste-proveedores'))");
      const [rows, ajustes] = await Promise.all([this.pendientes(manager), this.ajustes(manager)]);
      const cubiertas = new Set(ajustes.flatMap((a) => a.compras));
      const disponibles = new Map(rows.filter((r) => !cubiertas.has(r.id_compra)).map((r) => [r.id_compra, r]));
      const pedidas = [...new Set(dto.compras)];
      const faltan = pedidas.filter((id) => !disponibles.has(id));
      if (faltan.length) throw new ConflictException(`Las compras ${faltan.join(', ')} ya tienen ajuste o ya no aplican; actualiza la propuesta`);
      const [proveedores] = await queryRows<{ id_cuenta: number }>(manager, "SELECT id_cuenta FROM cuenta_contable WHERE codigo='2100' AND activa AND acepta_movimientos");
      if (!proveedores) throw new BadRequestException('La cuenta 2100 Proveedores no está disponible');
      const [contra] = await queryRows<{ id_cuenta: number; codigo: string }>(manager,
        'SELECT id_cuenta, codigo FROM cuenta_contable WHERE id_cuenta=$1 AND activa AND acepta_movimientos FOR SHARE', [dto.idCuentaContrapartida]);
      if (!contra) throw new BadRequestException('La cuenta de contrapartida no existe, está inactiva o no acepta movimientos');
      if (contra.id_cuenta === proveedores.id_cuenta) throw new BadRequestException('La contrapartida no puede ser Proveedores');
      const compras = pedidas.map((id) => disponibles.get(id)!);
      const total = money(compras.reduce((s, c) => s + Number(c.abono), 0));
      const concepto = `F02 · Ajuste de Proveedores: ${compras.length} compra(s) de contado sin pago contable · ${dto.motivo}`.slice(0, 300);
      const [poliza] = await queryRows<{ id_poliza: string; folio: string }>(manager,
        "INSERT INTO poliza_contable(fecha,tipo,concepto,id_usuario) VALUES($1,'Diario',$2,$3) RETURNING id_poliza, folio", [dto.fecha, concepto, idUsuario ?? null]);
      for (const c of compras) {
        await manager.query(
          `INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,referencia,debe,haber,id_centro_costo) VALUES($1,$2,$3,$4,$5,0,fn_centro_general())`,
          [poliza.id_poliza, proveedores.id_cuenta, `Pago de contado no registrado · compra ${c.id_compra} (${c.fecha})`.slice(0, 300), `${REFERENCIA_F02}${c.id_compra}`, money(Number(c.abono))]);
      }
      await manager.query(
        `INSERT INTO poliza_contable_detalle(id_poliza,id_cuenta,concepto,referencia,debe,haber,id_centro_costo) VALUES($1,$2,$3,'F02:contrapartida',0,$4,fn_centro_general())`,
        [poliza.id_poliza, contra.id_cuenta, `Contrapartida elegida (${contra.codigo})`, total]);
      return { idPoliza: Number(poliza.id_poliza), folio: Number(poliza.folio), estado: 'Borrador', compras: compras.length, total };
    });
  }
}
