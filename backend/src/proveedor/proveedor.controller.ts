// backend/src/proveedor/proveedor.controller.ts (REEMPLAZAR)

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  ParseIntPipe,
  Put,
  Delete,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { ProveedorService } from './proveedor.service';
import { CreateProveedorDto, UpdateProveedorDto } from './proveedor.dto';

import { DirectoryQueryDto } from '../common/directory-query';

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

  @Get('pagina')
  findPage(@Query() query: DirectoryQueryDto) {
    return this.proveedorService.findPage(query);
  }

  @Get('exportar')
  async exportCsv(@Query() query: DirectoryQueryDto) {
    const csv = await this.proveedorService.exportCsv(query);
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8', disposition: 'attachment; filename="proveedores.csv"',
    });
  }
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.proveedorService.findOne(id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProveedorDto: UpdateProveedorDto,
  ) {
    return this.proveedorService.update(id, updateProveedorDto);
  }

  @Delete(':id')
  @Roles(RolUsuario.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.proveedorService.remove(id);
  }
}
