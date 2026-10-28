import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { JwtPayload } from '../auth/auth.types';
import { CreateVistaGuardadaDto, RutaVistaDto } from './vistas-guardadas.dto';
import { VistasGuardadasService } from './vistas-guardadas.service';

/** U02.2 · Vistas propias de cada usuario: sólo filtros de listados; los datos siguen sujetos a cada listado. */
@Controller('vistas-guardadas')
export class VistasGuardadasController {
  constructor(private readonly vistas: VistasGuardadasService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  list(@Query() query: RutaVistaDto, @Req() req: { user: JwtPayload }) {
    return this.vistas.list(req.user.idUser!, query.ruta);
  }

  @Post()
  save(@Body() dto: CreateVistaGuardadaDto, @Req() req: { user: JwtPayload }) {
    return this.vistas.save(req.user.idUser!, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload }) {
    return this.vistas.remove(req.user.idUser!, id);
  }
}
