// backend/src/proveedor/proveedor.controller.ts (REEMPLAZAR)

import { Controller, Get, Post, Body, Param, ParseIntPipe, Put, Delete } from '@nestjs/common';
import { ProveedorService } from './proveedor.service';
import { CreateProveedorDto, UpdateProveedorDto } from './proveedor.dto';

@Controller('proveedores') // Endpoint: /api/v1/proveedores
export class ProveedorController {
  constructor(private readonly proveedorService: ProveedorService) {}

  @Post()
  create(@Body() createProveedorDto: CreateProveedorDto) {
    return this.proveedorService.create(createProveedorDto);
  }

  @Get()
  findAll() {
    return this.proveedorService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.proveedorService.findOne(id);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateProveedorDto: UpdateProveedorDto) {
    return this.proveedorService.update(id, updateProveedorDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.proveedorService.remove(id);
  }
}