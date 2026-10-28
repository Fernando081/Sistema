import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { Permissions } from '../auth/permissions.decorator';
import { JwtPayload } from '../auth/auth.types';
import { SalidaDocumentosService } from './salida-documentos.service';
import {
  SalidaCancelarDto,
  SalidaConciliarDto,
  SalidaCerrarDto,
  SalidaPrepararDto,
  SalidaQuery,
} from './salida-documentos.dto';
@Controller('venta')
@Permissions('ventas.correo.gestionar')
export class SalidaDocumentosController {
  constructor(private readonly service: SalidaDocumentosService) {}
  @Get(':id/preparar-correo')
  @Header('Cache-Control', 'private, no-store')
  preview(
    @Param('id', ParseIntPipe) id: number,
    @Req() r: { user: JwtPayload },
  ) {
    return this.service.preview(id, r.user);
  }
  @Post(':id/enviar-correo')
  @Header('Cache-Control', 'private, no-store')
  prepare(
    @Param('id', ParseIntPipe) id: number,
    @Body() d: SalidaPrepararDto,
    @Req() r: { user: JwtPayload },
  ) {
    return this.service.prepare(id, d, r.user);
  }
  @Get(':id/correos')
  @Header('Cache-Control', 'private, no-store')
  list(
    @Param('id', ParseIntPipe) id: number,
    @Query() q: SalidaQuery,
    @Req() r: { user: JwtPayload },
  ) {
    return this.service.list(id, q.page, r.user);
  }
  @Post(':id/correos/:request/simular')
  @Header('Cache-Control', 'private, no-store')
  simulate(
    @Param('id', ParseIntPipe) id: number,
    @Param('request', new ParseUUIDPipe({ version: '4' })) request: string,
    @Body() d: SalidaCerrarDto,
    @Req() r: { user: JwtPayload },
  ) {
    return this.service.close(id, request, d, r.user);
  }
  @Post(':id/correos/:request/cancelar')
  @Header('Cache-Control', 'private, no-store')
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Param('request', new ParseUUIDPipe({ version: '4' })) request: string,
    @Body() d: SalidaCancelarDto,
    @Req() r: { user: JwtPayload },
  ) {
    return this.service.close(id, request, d, r.user, true);
  }
  /** O01.2b · Decisión de un administrador sobre un envío Incierto (respuesta del servidor perdida). */
  @Post(':id/correos/:request/conciliar')
  @Header('Cache-Control', 'private, no-store')
  reconcile(
    @Param('id', ParseIntPipe) id: number,
    @Param('request', new ParseUUIDPipe({ version: '4' })) request: string,
    @Body() d: SalidaConciliarDto,
    @Req() r: { user: JwtPayload },
  ) {
    return this.service.conciliar(id, request, d, r.user);
  }
  @Get(':id/correos/:request/pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async file(
    @Param('id', ParseIntPipe) id: number,
    @Param('request', new ParseUUIDPipe({ version: '4' })) request: string,
    @Req() r: { user: JwtPayload },
  ) {
    return new StreamableFile(await this.service.file(id, request, r.user), {
      type: 'application/pdf',
      disposition: 'attachment; filename="documento-preparado.pdf"',
    });
  }
}
