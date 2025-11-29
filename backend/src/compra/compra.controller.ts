// frontend/src/app/compra/compra.controller.ts
import { Body, Controller, Post, Get, Param } from '@nestjs/common';
import { CompraService } from './compra.service';
import { CreateCompraDto } from './compra.dto';

@Controller('compra')
export class CompraController {
  constructor(private readonly compraService: CompraService) {}

  @Post()
  create(@Body() createCompraDto: CreateCompraDto) {
    return this.compraService.create(createCompraDto);
  }
  
  @Get()
  findAll() {
    return this.compraService.findAll();
  }

  @Get(':id/detalle')
  findDetalle(@Param('id') id: number) {
    return this.compraService.findDetalle(id);
  }
}