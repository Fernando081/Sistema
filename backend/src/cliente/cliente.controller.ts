// backend/src/cliente/cliente.controller.ts

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  Put,
  Delete,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { ClienteService } from './cliente.service';
import { CreateClienteContactoDto, CreateClienteDto, UpdateClienteDto } from './cliente.dto'; // Importamos los DTOs

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

  @Get(':id/360')
  find360(@Param('id', ParseIntPipe) id: number) {
    return this.clienteService.find360(id);
  }

  @Post(':id/contactos')
  addContacto(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateClienteContactoDto) {
    return this.clienteService.addContacto(id, dto);
  }

  @Delete(':id/contactos/:idContacto')
  deleteContacto(@Param('id', ParseIntPipe) id: number, @Param('idContacto', ParseIntPipe) idContacto: number) {
    return this.clienteService.deleteContacto(id, idContacto);
  }

  // ¡CAMBIO! El parámetro ahora es 'id' (numérico)
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateClienteDto: UpdateClienteDto,
  ) {
    return this.clienteService.update(id, updateClienteDto);
  }

  // ¡CAMBIO! El parámetro ahora es 'id' (numérico)
  @Delete(':id')
  @Roles(RolUsuario.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.clienteService.remove(id);
  }
}
