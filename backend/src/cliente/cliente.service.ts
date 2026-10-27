// backend/src/cliente/cliente.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Cliente } from './cliente.entity';
import { CreateClienteContactoDto, CreateClienteDto, UpdateClienteDto } from './cliente.dto'; // Importamos los DTOs
import { queryRows } from '../common/database/typed-query';

import { DirectoryQueryDto, directoryPage, directoryCsv } from '../common/directory-query';

@Injectable()
export class ClienteService {
  constructor(
    // ¡CAMBIO! Inyectamos el DataSource para ejecutar consultas directas
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  // --- CRUD usando Funciones de PostgreSQL (SPs) ---

  async findAll(): Promise<Cliente[]> {
    // ¡CAMBIO! Ahora llama a tu función de PostgreSQL
    return queryRows<Cliente>(this.dataSource, 'SELECT * FROM fn_get_clientes()');
  }

  findPage(query: DirectoryQueryDto) {
    return directoryPage<Record<string, unknown>>(this.dataSource, 'cliente', query);
  }

  exportCsv(query: DirectoryQueryDto) {
    return directoryCsv(this.dataSource, 'cliente', query);
  }

  async findOne(idCliente: number): Promise<Cliente> {
    const result = await queryRows<Cliente>(this.dataSource,
      'SELECT * FROM fn_get_cliente_by_id($1) WHERE "IdCliente" IS NOT NULL',
      [idCliente],
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(`Cliente con ID ${idCliente} no encontrado.`);
    }
    return result[0];
  }

  async find360(idCliente: number) {
    const cliente = await this.findOne(idCliente);
    const [contactos, unidades, cotizaciones, pedidos, facturas, garantias, oportunidades] = await Promise.all([
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT id_contacto AS "idContacto",nombre,cargo,telefono,email,
        canal_preferido AS "canalPreferido",es_principal AS "esPrincipal",notas FROM cliente_contacto
        WHERE id_cliente=$1 ORDER BY es_principal DESC,nombre`, [idCliente]),
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT id_unidad AS "idUnidad",vin,esn,numero_economico AS "numeroEconomico",
        marca,modelo,anio,motor,transmision,diferencial,placas,notas FROM crm_unidad_cliente
        WHERE id_cliente=$1 ORDER BY updated_at DESC`, [idCliente]),
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT id_cotizacion AS "idCotizacion",folio,estatus,total,id_unidad AS "idUnidad"
        FROM cotizacion WHERE id_cliente=$1 ORDER BY id_cotizacion DESC LIMIT 50`, [idCliente]),
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT id_pedido AS "idPedido",folio,estado,total,id_unidad AS "idUnidad",
        created_at AS "createdAt" FROM pedido_venta WHERE id_cliente=$1 ORDER BY created_at DESC LIMIT 50`, [idCliente]),
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT id_factura AS "idFactura",serie,folio,fecha_emision AS "fechaEmision",
        estatus,total,saldo_pendiente AS "saldoPendiente",id_unidad AS "idUnidad"
        FROM factura WHERE id_cliente=$1 ORDER BY fecha_emision DESC,id_factura DESC LIMIT 50`, [idCliente]),
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT g.id_garantia AS "idGarantia",g.estado,g.motivo,g.cantidad,
        g.created_at AS "createdAt",concat(f.serie,'-',f.folio) AS factura,cf.descripcion AS producto
        FROM garantia g JOIN factura f ON f.id_factura=g.id_factura
        JOIN conceptofactura cf ON cf.id_concepto=g.id_concepto WHERE f.id_cliente=$1
        ORDER BY g.created_at DESC LIMIT 50`, [idCliente]),
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT id_oportunidad AS "idOportunidad",empresa,etapa,
        monto_estimado AS "montoEstimado",siguiente_accion AS "siguienteAccion",
        fecha_siguiente_accion AS "fechaSiguienteAccion" FROM crm_oportunidad
        WHERE id_cliente=$1 ORDER BY updated_at DESC LIMIT 50`, [idCliente]),
    ]);
    const saldoPendiente = facturas.reduce((sum, row) => sum + Number(row.saldoPendiente || 0), 0);
    const ventasAcumuladas = facturas.filter(row => row.estatus !== 'Cancelada')
      .reduce((sum, row) => sum + Number(row.total || 0), 0);
    return { cliente, resumen: { saldoPendiente, ventasAcumuladas, unidades: unidades.length,
      pedidosAbiertos: pedidos.filter(row => !['Facturado','Cancelado'].includes(String(row.estado))).length,
      garantiasAbiertas: garantias.filter(row => !['Cerrada','Rechazada'].includes(String(row.estado))).length },
      contactos, unidades, cotizaciones, pedidos, facturas, garantias, oportunidades };
  }

  async addContacto(idCliente: number, dto: CreateClienteContactoDto) {
    await this.findOne(idCliente);
    return this.dataSource.transaction(async manager => {
      if (dto.esPrincipal) await manager.query('UPDATE cliente_contacto SET es_principal=false,updated_at=now() WHERE id_cliente=$1', [idCliente]);
      const rows = await queryRows<{ idContacto: number }>(manager, `INSERT INTO cliente_contacto
        (id_cliente,nombre,cargo,telefono,email,canal_preferido,es_principal,notas)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_contacto AS "idContacto"`,
      [idCliente, dto.nombre, dto.cargo || null, dto.telefono || null, dto.email || null,
        dto.canalPreferido, dto.esPrincipal, dto.notas || null]);
      return rows[0];
    });
  }

  async deleteContacto(idCliente: number, idContacto: number) {
    const result: unknown[] = await this.dataSource.query('DELETE FROM cliente_contacto WHERE id_contacto=$1 AND id_cliente=$2 RETURNING id_contacto', [idContacto, idCliente]);
    if (!result.length) throw new NotFoundException('Contacto no encontrado');
    return { message: 'Contacto eliminado' };
  }

  async create(createClienteDto: CreateClienteDto): Promise<Cliente> {
    // ¡CAMBIO! Ahora llama a tu función de PostgreSQL
    const result = await queryRows<Cliente>(this.dataSource,
      'SELECT * FROM fn_create_cliente($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)',
      [
        createClienteDto.rfc,
        createClienteDto.razonSocial,
        createClienteDto.pais,
        createClienteDto.idEstado,
        createClienteDto.idMunicipio,
        createClienteDto.ciudad,
        createClienteDto.colonia,
        createClienteDto.calle,
        createClienteDto.codigoPostal,
        createClienteDto.numeroExterior,
        createClienteDto.numeroInterior,
        createClienteDto.referencia,
        createClienteDto.idMetodoDePago,
        createClienteDto.idUsoCFDI,
        createClienteDto.idFormaPago,
        createClienteDto.idRegimenFiscal,
        createClienteDto.email || null,
      ],
    );
    return result[0];
  }

  async update(
    idCliente: number,
    updateClienteDto: UpdateClienteDto,
  ): Promise<Cliente> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await queryRows<Record<string, unknown>>(manager, 'SELECT * FROM cliente WHERE "IdCliente"=$1 FOR UPDATE', [idCliente]);
      if (!rows.length) throw new NotFoundException(`Cliente con ID ${idCliente} no encontrado.`);
      // Las funciones retornan nombres PostgreSQL (RFC/RazonSocial), no propiedades de la entidad.
      const fields = [
        ['rfc', 'RFC'], ['razonSocial', 'RazonSocial'], ['pais', 'Pais'],
        ['idEstado', 'IdEstado'], ['idMunicipio', 'IdMunicipio'], ['ciudad', 'Ciudad'],
        ['colonia', 'Colonia'], ['calle', 'Calle'], ['codigoPostal', 'CodigoPostal'],
        ['numeroExterior', 'NumeroExterior'], ['numeroInterior', 'NumeroInterior'],
        ['referencia', 'Referencia'], ['idMetodoDePago', 'IdMetodoDePago'],
        ['idUsoCFDI', 'IdUsoCFDI'], ['idFormaPago', 'IdFormaPago'],
        ['idRegimenFiscal', 'IdRegimenFiscal'], ['email', 'email'],
      ] as const;
      const values = fields.map(([field, column]) =>
        updateClienteDto[field] !== undefined ? updateClienteDto[field] : rows[0][column]);
      const result = await queryRows<Cliente>(manager,
      'SELECT * FROM fn_update_cliente($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)',
        [idCliente, ...values],
      );
      return result[0];
    });
  }

  async remove(idCliente: number): Promise<void> {
    // ¡CAMBIO! Llama a la función de PostgreSQL
    const result = await queryRows<Cliente>(this.dataSource,
      'SELECT * FROM fn_delete_cliente($1) WHERE "IdCliente" IS NOT NULL',
      [idCliente],
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(`Cliente con ID ${idCliente} no encontrado.`);
    }
  }
}
