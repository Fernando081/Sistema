// backend/src/producto/producto.service.ts

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Producto } from './producto.entity';
import { CreateAplicacionDto, CreateNumeroParteDto, CreateProductoDto, UpdateProductoDto, SmartRestockItem, PrediccionDemandaItem, CreateCotizacionProvDto } from './producto.dto';
import { APP_CONSTANTS } from '../common/constants/app.constants';
import { csvDocument } from '../common/csv';
import { queryRows, readSnapshot } from '../common/database/typed-query';

export interface ProductoDbRow {
  IdProducto: number;
  Codigo: string | null;
  IdUnidad: number | null;
  IdObjetoImpuesto: number | null;
  Descripcion: string;
  PrecioUnitario: number | string;
  IdCategoria: number | null;
  Ubicacion: string | null;
  IdClaveProdOServ: number | null;
  IdClaveUnidad: number | null;
  Marca: string | null;
  ObjetoImpuesto: string;
  TasaIVA: number | string;
  AplicaRetencionISR: boolean;
  AplicaRetencionIVA: boolean;
  Existencia: number | string;
  imagenes?: string[];
  [key: string]: unknown;
}

export interface ProductoPage {
  data: ProductoDbRow[];
  total: number;
  page: number;
  totalPages: number;
}

interface CountRow { count: string | number; }
interface CotizacionProveedorIdRow { id_cotizacion_prov: number; }
export interface NumeroParteIdRow { idNumero: number; }
export interface AplicacionIdRow { idAplicacion: number; }

export const PRODUCT_SOURCE = `(SELECT p."IdProducto",p."Codigo",p."IdUnidad",p."IdObjetoImpuesto",p."Descripcion",
  p."PrecioUnitario",p."IdCategoria",p."Ubicacion",p."IdClaveProdOServ",p."IdClaveUnidad",p."Marca",
  p."ObjetoImpuesto",p."TasaIVA",p."AplicaRetencionISR",p."AplicaRetencionIVA",p."Existencia",
  c."Descripcion" AS "CategoriaNombre",cps."Clave" AS "ClaveProdServ",cps."Descripcion"::text AS "DescripcionProdServ",
  cu."Clave" AS "ClaveUnidadSat",cu."Descripcion"::text AS "DescripcionUnidadSat",
  COALESCE((SELECT jsonb_agg(pe."IdProductoEquivalente") FROM producto_equivalente pe
    WHERE pe."IdProducto"=p."IdProducto"),'[]'::jsonb) AS "EquivalentesJSON",p."imagenes"
  FROM producto p LEFT JOIN categoria c ON p."IdCategoria"=c."IdCategoria"
  LEFT JOIN claveproductooservicio cps ON p."IdClaveProdOServ"=cps."IdClaveProdOServ"
  LEFT JOIN claveunidad cu ON p."IdClaveUnidad"=cu."IdClaveUnidad")`;

export const PRODUCT_LITERAL_FROM = `
      FROM ${PRODUCT_SOURCE} fp
      WHERE $1 = ''
         OR COALESCE(fp."Codigo", '') ILIKE '%' || $2 || '%'
         OR COALESCE(fp."Descripcion", '') ILIKE '%' || $2 || '%'
         OR COALESCE(fp."Marca", '') ILIKE '%' || $2 || '%'
         OR COALESCE(fp."CategoriaNombre", '') ILIKE '%' || $2 || '%'
         OR EXISTS (
           SELECT 1 FROM producto_numero_parte np
            WHERE np.id_producto = fp."IdProducto"
              AND regexp_replace($1, '[^[:alnum:]]', '', 'g') <> ''
              AND np.numero_normalizado LIKE '%' || lower(regexp_replace($1, '[^[:alnum:]]', '', 'g')) || '%'
         )
         OR EXISTS (
           SELECT 1 FROM producto_aplicacion pa
            WHERE pa.id_producto = fp."IdProducto"
              AND concat_ws(' ', pa.fabricante_equipo, pa.modelo, pa.motor, pa.restricciones) ILIKE '%' || $2 || '%'
         )`;

export const PRODUCT_MATCH_SOURCE = `SELECT p."IdProducto" AS id FROM producto p
 WHERE COALESCE(p."Codigo",'') ILIKE '%'||$2||'%' OR COALESCE(p."Descripcion",'') ILIKE '%'||$2||'%' OR COALESCE(p."Marca",'') ILIKE '%'||$2||'%'
 UNION SELECT p."IdProducto" AS id FROM producto p JOIN categoria c ON p."IdCategoria"=c."IdCategoria" WHERE COALESCE(c."Descripcion",'') ILIKE '%'||$2||'%'
 UNION SELECT np.id_producto AS id FROM producto_numero_parte np JOIN producto p ON p."IdProducto"=np.id_producto WHERE regexp_replace($1, '[^[:alnum:]]', '', 'g') <> '' AND np.numero_normalizado LIKE '%'||lower(regexp_replace($1,'[^[:alnum:]]','','g'))||'%'
 UNION SELECT pa.id_producto AS id FROM producto_aplicacion pa JOIN producto p ON p."IdProducto"=pa.id_producto
 WHERE public.product_application_text(ARRAY[pa.fabricante_equipo::text,pa.modelo::text,pa.motor::text,pa.restricciones::text]) ILIKE '%'||$2||'%'`;
export const PRODUCT_INDEXED_FROM = `FROM ${PRODUCT_SOURCE} fp JOIN (${PRODUCT_MATCH_SOURCE}) hits ON hits.id=fp."IdProducto"`;

@Injectable()
export class ProductoService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async findAll(page: number = 1, limit: number = 10, sort?: string, order?: string, term: string = ''): Promise<ProductoPage> {
    return readSnapshot(this.dataSource, async source => {
      const safePage = Math.max(1, page);
      const safeLimit = Math.min(Math.max(1, limit), 100);
      const offset = (safePage - 1) * safeLimit;

      const { filterSql, orderClause, parameters } = this.listQuery(sort, order, term);
      const totalResult = await queryRows<CountRow>(source, `SELECT COUNT(*) as count ${filterSql}`, parameters);
      const dataResult = await queryRows<ProductoDbRow>(source,
          `SELECT fp.*, COALESCE(res.cantidad,0) AS "Reservada",
            GREATEST(fp."Existencia"-COALESCE(res.cantidad,0),0) AS "Disponible"
            FROM (SELECT fp.* ${filterSql}${orderClause} LIMIT $3 OFFSET $4) fp
            LEFT JOIN LATERAL (
              SELECT sum(r.cantidad-r.cantidad_liberada) cantidad FROM reserva_inventario r
              WHERE r.id_producto=fp."IdProducto" AND r.estado IN ('Activa','Surtida')
            ) res ON true ${orderClause}`,
          [...parameters, safeLimit, offset],
        );

      const total = Number(totalResult[0].count);
      const totalPages = Math.ceil(total / safeLimit);

      return {
        data: dataResult,
        total,
        page: safePage,
        totalPages,
      };
    });
  }

  private listQuery(sort: string | undefined, order: string | undefined, term: string) {
    const sortMap: Record<string, string> = {
      codigo: '"Codigo"',
      descripcion: '"Descripcion"',
      categoriaNombre: '"CategoriaNombre"',
      marca: '"Marca"',
      ubicacion: '"Ubicacion"',
      precioUnitario: '"PrecioUnitario"',
      existencia: '"Existencia"',
    };

    let orderClause = ' ORDER BY "IdProducto" DESC';
    if (sort && Object.hasOwn(sortMap, sort)) {
      const direction = order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      orderClause = ` ORDER BY ${sortMap[sort]} ${direction}, "IdProducto" DESC`;
    }

    const filterSql = /[\p{L}\p{N}]{3}/u.test(term.trim()) ? PRODUCT_INDEXED_FROM : PRODUCT_LITERAL_FROM;
    const escapedTerm = term.trim().replace(/[\\%_]/g, value => '\\' + value);
    return { filterSql, orderClause, parameters: [term.trim(), escapedTerm] };
  }

  async exportCsv(sort?: string, order?: string, term = ''): Promise<string> {
    const { filterSql, orderClause, parameters } = this.listQuery(sort, order, term);
    const rows = await queryRows<ProductoDbRow>(this.dataSource, `SELECT fp.* ${filterSql}${orderClause} LIMIT 5001`, parameters);
    if (rows.length > 5000) throw new BadRequestException('La exportación supera 5000 registros. Reduce la búsqueda y vuelve a exportar.');
    return csvDocument(['IdProducto', 'Codigo', 'Descripcion', 'CategoriaNombre', 'Marca', 'Ubicacion', 'PrecioUnitario', 'Existencia'], rows);
  }

  async findOne(idProducto: number): Promise<ProductoDbRow> {
    const result = await queryRows<ProductoDbRow>(this.dataSource,
      `SELECT fp.*,
        COALESCE((SELECT sum(r.cantidad-r.cantidad_liberada) FROM reserva_inventario r
          WHERE r.id_producto=fp."IdProducto" AND r.estado IN ('Activa','Surtida')),0) AS "Reservada",
        GREATEST(fp."Existencia"-COALESCE((SELECT sum(r.cantidad-r.cantidad_liberada) FROM reserva_inventario r
          WHERE r.id_producto=fp."IdProducto" AND r.estado IN ('Activa','Surtida')),0),0) AS "Disponible"
        FROM fn_get_producto_by_id($1) fp`,
      [idProducto],
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(
        `Producto con ID ${idProducto} no encontrado.`,
      );
    }
    return result[0];
  }

  // --- CORREGIDO PARA LOS NUEVOS PARÁMETROS ---
  async create(createProductoDto: CreateProductoDto): Promise<Producto> {
    const result = await queryRows<Producto>(this.dataSource,
      // Ahora enviamos 15 parámetros
      'SELECT * FROM fn_create_producto($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)',
      [
        createProductoDto.codigo,
        createProductoDto.idUnidad,
        createProductoDto.idObjetoImpuesto,
        createProductoDto.descripcion,
        createProductoDto.precioUnitario,
        createProductoDto.idCategoria,
        createProductoDto.ubicacion,
        createProductoDto.idClaveProdOServ,
        createProductoDto.idClaveUnidad,
        createProductoDto.marca,
        // NUEVOS CAMPOS (Con valores por defecto)
        createProductoDto.objetoImpuestoSat || APP_CONSTANTS.TAX_OBJECT_DEFAULT,
        createProductoDto.tasaIva ?? APP_CONSTANTS.TAX_RATE_DEFAULT,
        createProductoDto.aplicaRetencionIsr || false,
        createProductoDto.aplicaRetencionIva || false,
        createProductoDto.imagenes ? JSON.stringify(createProductoDto.imagenes) : '[]',
      ],
    );
    return result[0];
  }

  async update(
    idProducto: number,
    updateProductoDto: UpdateProductoDto,
  ): Promise<Producto> {
    const productoActual = await this.findOne(idProducto);
    if (!productoActual)
      throw new NotFoundException(`Producto ${idProducto} no encontrado.`);

    // Mapeo para coincidir con la respuesta de BD
    const productoActualMapeado = {
      // ... tus campos anteriores ...
      codigo: productoActual['Codigo'],
      idUnidad: productoActual['IdUnidad'],
      idObjetoImpuesto: productoActual['IdObjetoImpuesto'],
      descripcion: productoActual['Descripcion'],
      precioUnitario: productoActual['PrecioUnitario'],
      idCategoria: productoActual['IdCategoria'],
      ubicacion: productoActual['Ubicacion'],
      idClaveProdOServ: productoActual['IdClaveProdOServ'],
      idClaveUnidad: productoActual['IdClaveUnidad'],
      marca: productoActual['Marca'],
      // Nuevos mapeos
      objetoImpuestoSat: productoActual['ObjetoImpuesto'],
      tasaIva: productoActual['TasaIVA'],
      aplicaRetencionIsr: productoActual['AplicaRetencionISR'],
      aplicaRetencionIva: productoActual['AplicaRetencionIVA'],
      existencia: productoActual['Existencia'],
      imagenes: productoActual['imagenes'],
    };

    const datos = { ...productoActualMapeado, ...updateProductoDto };

    const result = await queryRows<Producto>(this.dataSource,
      // Ahora enviamos 16 parámetros (ID + 15 datos)
      'SELECT * FROM fn_update_producto($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)',
      [
        idProducto,
        datos.codigo,
        datos.idUnidad,
        datos.idObjetoImpuesto,
        datos.descripcion,
        datos.precioUnitario,
        datos.idCategoria,
        datos.ubicacion,
        datos.idClaveProdOServ,
        datos.idClaveUnidad,
        datos.marca,
        // Nuevos
        datos.objetoImpuestoSat,
        datos.tasaIva,
        datos.aplicaRetencionIsr,
        datos.aplicaRetencionIva,
        datos.imagenes ? JSON.stringify(datos.imagenes) : '[]',
      ],
    );
    return result[0];
  }

  async remove(idProducto: number): Promise<void> {
    const result = await queryRows<Record<string, unknown>>(this.dataSource,
      'SELECT * FROM fn_delete_producto($1)',
      [idProducto],
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(
        `Producto con ID ${idProducto} no encontrado.`,
      );
    }
  }

  async getKardex(idProducto: number) {
    // Consultamos la tabla unificada que creamos
    const resultado = await queryRows<Record<string, unknown>>(this.dataSource,
      `
    SELECT 
      id_kardex,
      fecha,
      tipo_movimiento,
      cantidad,
      stock_anterior,
      stock_resultante,
      precio_unitario,
      referencia
    FROM kardex 
    WHERE id_producto = $1 
    ORDER BY fecha DESC
    `,
      [idProducto],
    );

    return resultado;
  }

  async getSmartRestock(): Promise<SmartRestockItem[]> {
    return queryRows<SmartRestockItem>(this.dataSource, 'SELECT * FROM vw_smart_restock');
  }

  async getHistorialPrecios(idProducto: number) {
    // ANTES: Llamaba a la función borrada fn_get_historial_precios
    // AHORA: Consultamos directamente la tabla 'kardex' unificada

    const historial = await queryRows<Record<string, unknown>>(this.dataSource,
      `
    SELECT 
      fecha, 
      precio_unitario as precio, -- Alias 'precio' para que tu frontend no se rompa
      referencia,
      tipo_movimiento
    FROM kardex 
    WHERE id_producto = $1
    ORDER BY fecha ASC
    `,
      [idProducto],
    );

    return historial;
  }

  // --- EQUIVALENTES ---
  async getEquivalentes(idProducto: number) {
    return queryRows<Record<string, unknown>>(this.dataSource, 'SELECT * FROM fn_get_equivalentes($1)', [
      idProducto,
    ]);
  }

  async agregarEquivalente(idProducto: number, idEquivalente: number) {
    if (idProducto === idEquivalente) throw new BadRequestException('Un producto no puede ser equivalente de sí mismo');
    await this.dataSource.query('SELECT fn_agregar_equivalente($1, $2)', [
      idProducto,
      idEquivalente,
    ]);
    return { message: 'Equivalente agregado' };
  }

  async eliminarEquivalente(idProducto: number, idEquivalente: number) {
    await this.dataSource.query(
      `DELETE FROM producto_equivalente WHERE "IdProducto" = $1 AND "IdProductoEquivalente" = $2`,
      [idProducto, idEquivalente],
    );
    return { message: 'Equivalente eliminado' };
  }

  // --- PREDICCIÓN DE DEMANDA (AI Smart Restock) ---
  async getPrediccionDemanda(): Promise<PrediccionDemandaItem[]> {
    return queryRows<PrediccionDemandaItem>(this.dataSource,
      'SELECT * FROM vw_prediccion_demanda WHERE cantidad_sugerida_compra > 0 ORDER BY cantidad_sugerida_compra DESC',
    );
  }

  async refreshPrediccion(): Promise<{ message: string }> {
    await this.dataSource.query('REFRESH MATERIALIZED VIEW CONCURRENTLY vw_prediccion_demanda');
    return { message: 'Vista de predicción de demanda actualizada correctamente' };
  }

  // --- COTIZACIONES PROVEEDORES ---
  async getCotizacionesProveedor(idProducto: number) {
    return queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT 
        c.id_cotizacion_prov,
        c.id_producto,
        c.id_proveedor,
        p."RazonSocial" as proveedor_nombre,
        c.marca_ofrecida,
        c.precio_cotizado,
        c.dias_entrega,
        c.fecha_registro
      FROM producto_cotizacion_prov c
      JOIN proveedor p ON c.id_proveedor = p."IdProveedor"
      WHERE c.id_producto = $1
      ORDER BY c.fecha_registro DESC
    `, [idProducto]);
  }

  async addCotizacionProveedor(idProducto: number, dto: CreateCotizacionProvDto) {
    const result = await queryRows<CotizacionProveedorIdRow>(this.dataSource, `
      INSERT INTO producto_cotizacion_prov (
        id_producto, id_proveedor, marca_ofrecida, precio_cotizado, dias_entrega
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING id_cotizacion_prov
    `, [
      idProducto,
      dto.idProveedor,
      dto.marcaOfrecida || null,
      dto.precioCotizado,
      dto.diasEntrega || 0
    ]);

    return { 
      message: 'Cotización guardada exitosamente', 
      idCotizacionProv: result[0].id_cotizacion_prov 
    };
  }

  // --- CRUCES / ALTERNATIVAS (BIDIRECCIONAL) ---
  async getAlternativas(idProducto: number) {
    return queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT 
        p."IdProducto" as id_producto,
        p."Codigo" as codigo,
        p."Descripcion" as descripcion,
        p."Marca" as marca,
        p."PrecioUnitario" as precio,
        p."Existencia" as stock
      FROM producto p
      INNER JOIN producto_cruce pc ON p."IdProducto" = pc.id_producto_destino
      WHERE pc.id_producto_origen = $1
      
      UNION
      
      SELECT 
        p."IdProducto" as id_producto,
        p."Codigo" as codigo,
        p."Descripcion" as descripcion,
        p."Marca" as marca,
        p."PrecioUnitario" as precio,
        p."Existencia" as stock
      FROM producto p
      INNER JOIN producto_cruce pc ON p."IdProducto" = pc.id_producto_origen
      WHERE pc.id_producto_destino = $1
    `, [idProducto]);
  }

  async ajustarInventario(idProducto: number, cantidad: number, tipo: string, motivo: string) {
    await this.dataSource.query(
      'CALL sp_ajustar_inventario($1, $2, $3, $4)',
      [idProducto, cantidad, tipo, motivo]
    );

    const updated = await this.findOne(idProducto);
    return {
      message: 'Ajuste de inventario realizado con éxito',
      existencia: Number(updated.Existencia || 0)
    };
  }

  getNumerosParte(idProducto: number) {
    return queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT id_numero AS "idNumero", tipo, fabricante, numero,
             numero_normalizado AS "numeroNormalizado"
        FROM producto_numero_parte WHERE id_producto=$1 ORDER BY tipo, fabricante, numero
    `, [idProducto]);
  }

  async addNumeroParte(idProducto: number, dto: CreateNumeroParteDto) {
    if (!/[\p{L}\p{N}]/u.test(dto.numero)) throw new BadRequestException('El número de parte debe contener letras o números');
    const result = await queryRows<NumeroParteIdRow>(this.dataSource, `
      INSERT INTO producto_numero_parte(id_producto,tipo,fabricante,numero)
      VALUES ($1,$2,$3,$4) RETURNING id_numero AS "idNumero"
    `, [idProducto, dto.tipo, dto.fabricante || null, dto.numero.trim()]);
    return result[0];
  }

  async deleteNumeroParte(idProducto: number, idNumero: number) {
    const result = await queryRows<Record<string, unknown>>(this.dataSource,
      'DELETE FROM producto_numero_parte WHERE id_producto=$1 AND id_numero=$2 RETURNING id_numero',
      [idProducto, idNumero],
    );
    if (!result.length) throw new NotFoundException('Número de parte no encontrado');
    return { message: 'Número de parte eliminado' };
  }

  getAplicaciones(idProducto: number) {
    return queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT id_aplicacion AS "idAplicacion", fabricante_equipo AS "fabricanteEquipo",
             modelo, motor, anio_desde AS "anioDesde", anio_hasta AS "anioHasta", restricciones
        FROM producto_aplicacion WHERE id_producto=$1 ORDER BY fabricante_equipo, modelo, motor
    `, [idProducto]);
  }

  async addAplicacion(idProducto: number, dto: CreateAplicacionDto) {
    if (![dto.fabricanteEquipo, dto.modelo, dto.motor].some((v) => v?.trim())) {
      throw new BadRequestException('Indica al menos fabricante, modelo o motor');
    }
    if (dto.anioDesde && dto.anioHasta && dto.anioDesde > dto.anioHasta) {
      throw new BadRequestException('El año inicial no puede ser posterior al final');
    }
    const result = await queryRows<AplicacionIdRow>(this.dataSource, `
      INSERT INTO producto_aplicacion(
        id_producto,fabricante_equipo,modelo,motor,anio_desde,anio_hasta,restricciones
      ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id_aplicacion AS "idAplicacion"
    `, [idProducto, dto.fabricanteEquipo || null, dto.modelo || null, dto.motor || null,
      dto.anioDesde || null, dto.anioHasta || null, dto.restricciones || null]);
    return result[0];
  }

  async deleteAplicacion(idProducto: number, idAplicacion: number) {
    const result = await queryRows<Record<string, unknown>>(this.dataSource,
      'DELETE FROM producto_aplicacion WHERE id_producto=$1 AND id_aplicacion=$2 RETURNING id_aplicacion',
      [idProducto, idAplicacion],
    );
    if (!result.length) throw new NotFoundException('Aplicación no encontrada');
    return { message: 'Aplicación eliminada' };
  }
}
