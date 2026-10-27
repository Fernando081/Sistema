import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { RolUsuario } from '../common/enums/app.enums';
import { CreateGarantiaDto, UpdateGarantiaDto } from './garantia.dto';
import { GarantiaService } from './garantia.service';
import { JwtPayload } from '../auth/auth.types';

@Controller('garantias')
export class GarantiaController {
  constructor(private readonly service: GarantiaService) {}

  @Get() findAll(@Req() req: { user: JwtPayload }) { return this.service.findAll(req.user); }
  @Post() create(@Body() dto: CreateGarantiaDto, @Req() req: { user: JwtPayload }) {
    return this.service.create(dto, req.user?.idUser);
  }
  @Patch(':id')
  @Roles(RolUsuario.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGarantiaDto,
    @Req() req: { user: JwtPayload },
  ) { return this.service.update(id, dto, req.user?.idUser); }
}
