import { Body, Controller, Get, Header, Param, ParseIntPipe, Put, Query, Req } from '@nestjs/common';
import { Equals, IsInt, IsString, MaxLength, Min } from 'class-validator';
import { JwtPayload } from '../auth/auth.types';
import { RolUsuario } from '../common/enums/app.enums';
import { CrmDocumentosService } from './crm-documentos.service';

export class CommercialLinkDto {
  @IsInt() @Min(1) expectedVersion: number;
  @Equals(true) confirmado: boolean;
}
export class CommercialClientDto extends CommercialLinkDto {
  @IsInt() @Min(1) idCliente: number;
}
export class CommercialSearchQuery {
  @IsString() @MaxLength(100) term = '';
}
@Controller('crm/oportunidades/:id/documentos-comerciales')
export class CrmDocumentosController {
  constructor(private readonly service: CrmDocumentosService) {}
  @Get() @Header('Cache-Control', 'private, no-store')
  list(@Param('id', ParseIntPipe) id: number, @Req() req: { user: JwtPayload }) {
    return this.service.list(id, req.user.idUser!, req.user.role === RolUsuario.ADMIN);
  }
  @Get('disponibles') @Header('Cache-Control', 'private, no-store')
  candidates(@Param('id', ParseIntPipe) id: number, @Query() query: CommercialSearchQuery, @Req() req: { user: JwtPayload }) {
    return this.service.candidates(id, query.term, req.user.idUser!, req.user.role === RolUsuario.ADMIN);
  }
  @Put('cliente') @Header('Cache-Control', 'private, no-store')
  client(@Param('id', ParseIntPipe) id: number, @Body() dto: CommercialClientDto, @Req() req: { user: JwtPayload }) {
    return this.service.client(id, dto.idCliente, dto.expectedVersion, req.user.idUser!, req.user.role === RolUsuario.ADMIN);
  }
  @Put('cotizaciones/:quote') @Header('Cache-Control', 'private, no-store')
  link(@Param('id', ParseIntPipe) id: number, @Param('quote', ParseIntPipe) quote: number,
    @Body() dto: CommercialLinkDto, @Req() req: { user: JwtPayload }) {
    return this.service.link(id, quote, dto.expectedVersion, req.user.idUser!, req.user.role === RolUsuario.ADMIN);
  }
  @Put('cotizaciones/:quote/retirar') @Header('Cache-Control', 'private, no-store')
  unlink(@Param('id', ParseIntPipe) id: number, @Param('quote', ParseIntPipe) quote: number,
    @Body() dto: CommercialLinkDto, @Req() req: { user: JwtPayload }) {
    return this.service.unlink(id, quote, dto.expectedVersion, req.user.idUser!, req.user.role === RolUsuario.ADMIN);
  }
}
