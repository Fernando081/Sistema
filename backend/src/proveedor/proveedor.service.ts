// backend/src/proveedor/proveedor.service.ts (REEMPLAZAR)

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Proveedor } from './proveedor.entity';
import { CreateProveedorDto, UpdateProveedorDto } from './proveedor.dto';

@Injectable()
export class ProveedorService {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  async findAll(): Promise<Proveedor[]> {
    return this.dataSource.query('SELECT * FROM fn_get_proveedores()');
  }

  async findOne(idProveedor: number): Promise<Proveedor> {
    const result = await this.dataSource.query('SELECT * FROM fn_get_proveedor_by_id($1)', [idProveedor]);
    if (!result || result.length === 0) {
      throw new NotFoundException(`Proveedor con ID ${idProveedor} no encontrado.`);
    }
    return result[0];
  }

  async create(createProveedorDto: CreateProveedorDto): Promise<Proveedor> {
    const result = await this.dataSource.query(
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
        createProveedorDto.idRegimenFiscal
      ]
    );
    return result[0];
  }

  async update(idProveedor: number, updateProveedorDto: UpdateProveedorDto): Promise<Proveedor> {
    const proveedorActual = await this.findOne(idProveedor);
    if (!proveedorActual) {
      throw new NotFoundException(`Proveedor con ID ${idProveedor} no encontrado.`);
    }
    
    const datosAActualizar = { ...proveedorActual, ...updateProveedorDto };

    const result = await this.dataSource.query(
      'SELECT * FROM fn_update_proveedor($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)',
      [
        idProveedor,
        datosAActualizar.rfc,
        datosAActualizar.razonSocial,
        datosAActualizar.pais,
        datosAActualizar.idEstado,
        datosAActualizar.idMunicipio,
        datosAActualizar.ciudad,
        datosAActualizar.colonia,
        datosAActualizar.calle,
        datosAActualizar.codigoPostal,
        datosAActualizar.numeroExterior,
        datosAActualizar.numeroInterior,
        datosAActualizar.referencia,
        datosAActualizar.idMetodoDePago,
        datosAActualizar.idUsoCFDI,
        datosAActualizar.idFormaPago,
        datosAActualizar.idRegimenFiscal
      ]
    );
    return result[0];
  }

  async remove(idProveedor: number): Promise<void> {
    const result = await this.dataSource.query('SELECT * FROM fn_delete_proveedor($1)', [idProveedor]);
    if (!result || result.length === 0) {
      throw new NotFoundException(`Proveedor con ID ${idProveedor} no encontrado.`);
    }
  }
}