// backend/src/cliente/cliente.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Cliente } from './cliente.entity';
import { CreateClienteDto, UpdateClienteDto } from './cliente.dto'; // Importamos los DTOs

@Injectable()
export class ClienteService {
  constructor(
    // ¡CAMBIO! Inyectamos el DataSource para ejecutar consultas directas
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  // --- CRUD usando Funciones de PostgreSQL (SPs) ---

  async findAll(): Promise<Cliente[]> {
    // ¡CAMBIO! Ahora llama a tu función de PostgreSQL
    return this.dataSource.query('SELECT * FROM fn_get_clientes()');
  }

  async findOne(idCliente: number): Promise<Cliente> {
    const result = await this.dataSource.query(
      'SELECT * FROM fn_get_cliente_by_id($1)',
      [idCliente],
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(`Cliente con ID ${idCliente} no encontrado.`);
    }
    return result[0];
  }

  async create(createClienteDto: CreateClienteDto): Promise<Cliente> {
    // ¡CAMBIO! Ahora llama a tu función de PostgreSQL
    const result = await this.dataSource.query(
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
    // ¡CAMBIO! Llama a la función de PostgreSQL
    const clienteActual = await this.findOne(idCliente);
    if (!clienteActual) {
      throw new NotFoundException(`Cliente con ID ${idCliente} no encontrado.`);
    }
    const datosAActualizar = { ...clienteActual, ...updateClienteDto };

    const result = await this.dataSource.query(
      'SELECT * FROM fn_update_cliente($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)',
      [
        idCliente,
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
        datosAActualizar.idRegimenFiscal,
        datosAActualizar.email || null,
      ],
    );
    return result[0];
  }

  async remove(idCliente: number): Promise<void> {
    // ¡CAMBIO! Llama a la función de PostgreSQL
    const result = await this.dataSource.query(
      'SELECT * FROM fn_delete_cliente($1)',
      [idCliente],
    );
    if (!result || result.length === 0) {
      throw new NotFoundException(`Cliente con ID ${idCliente} no encontrado.`);
    }
  }
}
