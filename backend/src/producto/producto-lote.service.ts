import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { setAuditActor } from '../auth/audit-actor';
import { QueryExecutor, queryRows } from '../common/database/typed-query';
import { AplicarProductoLoteDto, ProductoLoteDto } from './producto-lote.dto';

interface ProductoRow { idProducto: number; codigo: string; descripcion: string; precio: string | number; idCategoria: number | null; categoria: string | null; }

export interface ProductoLoteCambio {
  idProducto: number;
  codigo: string;
  descripcion: string;
  precioActual: number;
  precioNuevo: number;
  idCategoriaActual: number | null;
  categoriaActual: string | null;
  idCategoriaNueva: number | null;
  categoriaNueva: string | null;
  cambia: boolean;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Precio nuevo según porcentaje y redondeo; nunca menor a un centavo (o a un peso si se redondea a pesos). */
export function nuevoPrecio(actual: number, porcentaje: number, redondeo: 'centavos' | 'pesos'): number {
  const bruto = actual * (1 + porcentaje / 100);
  return redondeo === 'pesos' ? Math.max(1, Math.round(bruto)) : Math.max(0.01, money(bruto));
}

/** U02.3 · Precios por porcentaje y categoría para varios productos, con vista previa y aplicación atómica. */
@Injectable()
export class ProductoLoteService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async vistaPrevia(dto: ProductoLoteDto) {
    return this.calcular(this.dataSource, dto, false);
  }

  async aplicar(dto: AplicarProductoLoteDto, idUser?: number) {
    const { requestId, ...payload } = dto;
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return this.dataSource.transaction(async (manager) => {
      await setAuditActor(manager, idUser);
      await manager.query(`SELECT pg_advisory_xact_lock(hashtext('producto-lote:' || $1))`, [requestId]);
      const previo = await queryRows<{ response: Record<string, unknown>; payload_hash: string }>(manager,
        `SELECT response, payload_hash FROM operation_idempotency WHERE request_id=$1 AND operation_type='producto_lote'`, [requestId]);
      if (previo.length) {
        if (previo[0].payload_hash !== hash) throw new BadRequestException('El identificador de reintento ya fue usado con datos diferentes');
        return previo[0].response;
      }
      const { cambios } = await this.calcular(manager, dto, true);
      const esperados = new Map(dto.esperados.map((e) => [e.idProducto, e]));
      const distintos = cambios.filter((c) => {
        const e = esperados.get(c.idProducto);
        return !e || money(Number(e.precio)) !== c.precioActual || (e.idCategoria !== undefined && (e.idCategoria ?? null) !== c.idCategoriaActual);
      });
      if (distintos.length || esperados.size !== cambios.length) {
        throw new ConflictException(`Cambiaron ${distintos.length || 'algunos'} producto(s) desde la vista previa; vuelve a revisarla antes de aplicar`);
      }
      let actualizados = 0;
      for (const c of cambios.filter((x) => x.cambia)) {
        if (dto.accion === 'precio') {
          await manager.query('UPDATE producto SET "PrecioUnitario"=$2 WHERE "IdProducto"=$1', [c.idProducto, c.precioNuevo]);
        } else {
          await manager.query('UPDATE producto SET "IdCategoria"=$2 WHERE "IdProducto"=$1', [c.idProducto, c.idCategoriaNueva]);
        }
        actualizados++;
      }
      const response = {
        message: actualizados ? `Se actualizaron ${actualizados} producto(s)` : 'No había cambios que aplicar',
        actualizados,
        sinCambio: cambios.length - actualizados,
      };
      await manager.query(
        `INSERT INTO operation_idempotency(request_id, operation_type, id_user, payload_hash, response) VALUES ($1,'producto_lote',$2,$3,$4::jsonb)`,
        [requestId, idUser ?? null, hash, JSON.stringify(response)]);
      return response;
    });
  }

  private async calcular(db: QueryExecutor | EntityManager, dto: ProductoLoteDto, bloquear: boolean) {
    const ids = [...new Set(dto.ids)].sort((a, b) => a - b);
    if (ids.length !== dto.ids.length) throw new BadRequestException('Hay productos repetidos en el lote');
    const rows = await queryRows<ProductoRow>(db,
      `SELECT p."IdProducto" AS "idProducto", p."Codigo" AS codigo, p."Descripcion" AS descripcion, p."PrecioUnitario" AS precio,
              p."IdCategoria" AS "idCategoria", c."Descripcion" AS categoria
         FROM producto p LEFT JOIN categoria c ON c."IdCategoria" = p."IdCategoria"
        WHERE p."IdProducto" = ANY($1::int[]) ORDER BY p."IdProducto"${bloquear ? ' FOR UPDATE OF p' : ''}`, [ids]);
    if (rows.length !== ids.length) throw new BadRequestException('Uno o más productos ya no existen');
    let categoriaNueva: string | null = null;
    if (dto.accion === 'categoria') {
      const cat = await queryRows<{ nombre: string }>(db, `SELECT "Descripcion" AS nombre FROM categoria WHERE "IdCategoria"=$1`, [dto.idCategoria]);
      if (!cat.length) throw new BadRequestException('La categoría no existe');
      categoriaNueva = cat[0].nombre;
    }
    const cambios: ProductoLoteCambio[] = rows.map((r) => {
      const precioActual = money(Number(r.precio));
      const precioNuevo = dto.accion === 'precio' ? nuevoPrecio(precioActual, Number(dto.porcentaje), dto.redondeo ?? 'centavos') : precioActual;
      const idCategoriaNueva = dto.accion === 'categoria' ? dto.idCategoria! : r.idCategoria;
      return {
        idProducto: r.idProducto, codigo: r.codigo, descripcion: r.descripcion,
        precioActual, precioNuevo,
        idCategoriaActual: r.idCategoria, categoriaActual: r.categoria,
        idCategoriaNueva, categoriaNueva: dto.accion === 'categoria' ? categoriaNueva : r.categoria,
        cambia: dto.accion === 'precio' ? precioNuevo !== precioActual : idCategoriaNueva !== r.idCategoria,
      };
    });
    return {
      cambios,
      resumen: {
        productos: cambios.length,
        conCambio: cambios.filter((c) => c.cambia).length,
        totalActual: money(cambios.reduce((s, c) => s + c.precioActual, 0)),
        totalNuevo: money(cambios.reduce((s, c) => s + c.precioNuevo, 0)),
      },
    };
  }
}
