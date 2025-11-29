// backend/src/cliente/cliente.controller.ts

import { Controller, Get, Post, Body, Param, ParseIntPipe, Put, Delete } from '@nestjs/common';
import { ClienteService } from './cliente.service';
import { CreateClienteDto, UpdateClienteDto } from './cliente.dto'; // Importamos los DTOs

@Controller('cliente') // Mantenemos el singular, como querías
export class ClienteController {
  constructor(private readonly clienteService: ClienteService) {}

  @Post()
  create(@Body() createClienteDto: CreateClienteDto) {
    return this.clienteService.create(createClienteDto);
  }

  @Get()
  findAll() {
    return this.clienteService.findAll();
  }

  // ¡CAMBIO! El parámetro ahora es 'id' (numérico) en lugar de 'rfc' (string)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.clienteService.findOne(id);
  }

  // ¡CAMBIO! El parámetro ahora es 'id' (numérico)
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateClienteDto: UpdateClienteDto) {
    return this.clienteService.update(id, updateClienteDto);
  }

  // ¡CAMBIO! El parámetro ahora es 'id' (numérico)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.clienteService.remove(id);
  }
}