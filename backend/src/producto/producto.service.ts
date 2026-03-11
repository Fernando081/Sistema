// backend/src/producto/producto.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Producto } from './producto.entity';
import { CreateProductoDto, UpdateProductoDto, SmartRestockItem, PrediccionDemandaItem } from './producto.dto';
import { APP_CONSTANTS } from '../common/constants/app.constants';

@Injectable()
export class ProductoService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async findAll(page: number = 1, limit: number = 10, sort?: string, order?: string): Promise<any> {
    const offset = (page - 1) * limit;

    const sortMap: Record<string, string> = {
      codigo: '"Codigo"',
      descripcion: '"Descripcion"',
      categoriaNombre: '"CategoriaNombre"',
      marca: '"Marca"',
      ubicacion: '"Ubicacion"',
      precioUnitario: '"PrecioUnitario"',
      existencia: '"Existencia"',
    };

    let orderClause = '';
    if (sort && sortMap[sort]) {
      const direction = order?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      orderClause = ` ORDER BY ${sortMap[sort]} ${direction}`;
    }

    const [totalResult, dataResult] = await Promise.all([
      this.dataSource.query('SELECT COUNT(*) as count FROM fn_get_productos()'),
      this.dataSource.query(
        `SELECT * FROM fn_get_productos($1, $2)${orderClause}`,
        [limit, offset]
      ),
    ]);

    const total = parseInt(totalResult[0].count, 10);
    const totalPages = Math.ceil(total / limit);

    return {
      data: dataResult,
      total,
      page,
      totalPages,
    };
  }

  async findOne(idProducto: number): Promise<any> {
    const result = await this.dataSource.query(
      'SELECT * FROM fn_get_producto_by_id($1)',
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
    const result = await this.dataSource.query(
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

    const result = await this.dataSource.query(
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
    const result = await this.dataSource.query(
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
    const resultado = await this.dataSource.query(
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
    return this.dataSource.query('SELECT * FROM vw_smart_restock');
  }

  async getHistorialPrecios(idProducto: number) {
    // ANTES: Llamaba a la función borrada fn_get_historial_precios
    // AHORA: Consultamos directamente la tabla 'kardex' unificada

    const historial = await this.dataSource.query(
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
    return this.dataSource.query('SELECT * FROM fn_get_equivalentes($1)', [
      idProducto,
    ]);
  }

  async agregarEquivalente(idProducto: number, idEquivalente: number) {
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
    return this.dataSource.query(
      'SELECT * FROM vw_prediccion_demanda WHERE cantidad_sugerida_compra > 0 ORDER BY cantidad_sugerida_compra DESC',
    );
  }

  async refreshPrediccion(): Promise<{ message: string }> {
    await this.dataSource.query('REFRESH MATERIALIZED VIEW CONCURRENTLY vw_prediccion_demanda');
    return { message: 'Vista de predicción de demanda actualizada correctamente' };
  }
}
