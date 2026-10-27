// backend/src/proveedor/proveedor.service.ts (REEMPLAZAR)

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Proveedor } from './proveedor.entity';
import { CreateProveedorDto, UpdateProveedorDto } from './proveedor.dto';
import { queryRows } from '../common/database/typed-query';

import { DirectoryQueryDto, directoryPage, directoryCsv } from '../common/directory-query';

@Injectable()
export class ProveedorService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async findAll(): Promise<Proveedor[]> {
    return queryRows<Proveedor>(this.dataSource, 'SELECT * FROM fn_get_proveedores()');
  }

  findPage(query: DirectoryQueryDto) {
    return directoryPage<Record<string, unknown>>(this.dataSource, 'proveedor', query);
  }

  exportCsv(query: DirectoryQueryDto) {
    return directoryCsv(this.dataSource, 'proveedor', query);
  }

  async findOne(idProveedor: number): Promise<Proveedor> {
    const result = await queryRows<Proveedor>(this.dataSource,
      'SELECT * FROM fn_get_proveedor_by_id($1) WHERE "IdProveedor" IS NOT NULL',
      [idProveedor],
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(
        `Proveedor con ID ${idProveedor} no encontrado.`,
      );
    }
    return result[0];
  }

  async create(createProveedorDto: CreateProveedorDto): Promise<Proveedor> {
    const result = await queryRows<Proveedor>(this.dataSource,
      'SELECT * FROM fn_create_proveedor($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)',
      [
        createProveedorDto.rfc,
        createProveedorDto.razonSocial,
        createProveedorDto.pais,
        createProveedorDto.idEstado,
        createProveedorDto.idMunicipio,
        createProveedorDto.ciudad,
        createProveedorDto.colonia,
        createProveedorDto.calle,
        createProveedorDto.codigoPostal,
        createProveedorDto.numeroExterior,
        createProveedorDto.numeroInterior,
        createProveedorDto.referencia,
        createProveedorDto.idMetodoDePago,
        createProveedorDto.idUsoCFDI,
        createProveedorDto.idFormaPago,
        createProveedorDto.idRegimenFiscal,
      ],
    );
    return result[0];
  }

  async update(
    idProveedor: number,
    updateProveedorDto: UpdateProveedorDto,
  ): Promise<Proveedor> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await queryRows<Record<string, unknown>>(manager, 'SELECT * FROM proveedor WHERE "IdProveedor"=$1 FOR UPDATE', [idProveedor]);
      if (!rows.length) throw new NotFoundException(`Proveedor con ID ${idProveedor} no encontrado.`);
      const fields = [
        ['rfc', 'RFC'], ['razonSocial', 'RazonSocial'], ['pais', 'Pais'],
        ['idEstado', 'IdEstado'], ['idMunicipio', 'IdMunicipio'], ['ciudad', 'Ciudad'],
        ['colonia', 'Colonia'], ['calle', 'Calle'], ['codigoPostal', 'CodigoPostal'],
        ['numeroExterior', 'NumeroExterior'], ['numeroInterior', 'NumeroInterior'],
        ['referencia', 'Referencia'], ['idMetodoDePago', 'IdMetodoDePago'],
        ['idUsoCFDI', 'IdUsoCFDI'], ['idFormaPago', 'IdFormaPago'], ['idRegimenFiscal', 'IdRegimenFiscal'],
      ] as const;
      const values = fields.map(([field, column]) =>
        updateProveedorDto[field] !== undefined ? updateProveedorDto[field] : rows[0][column]);
      const result = await queryRows<Proveedor>(manager,
      'SELECT * FROM fn_update_proveedor($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)',
        [idProveedor, ...values],
      );
      return result[0];
    });
  }

  async remove(idProveedor: number): Promise<void> {
    const result = await queryRows<Proveedor>(this.dataSource,
      'SELECT * FROM fn_delete_proveedor($1) WHERE "IdProveedor" IS NOT NULL',
      [idProveedor],
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(
        `Proveedor con ID ${idProveedor} no encontrado.`,
      );
    }
  }
}
