import { Controller, Get, Param, ParseIntPipe, Post, Req, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { Permissions } from '../auth/permissions.decorator';
import { JwtPayload } from '../auth/auth.types';
import { FiscalService } from './fiscal.service';
import { FiscalDocumentType } from './fiscal.types';

@Controller('fiscal')
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  @Get('configuracion')
  configuration() { return this.fiscal.configurationStatus(); }

  @Get(':type/:id')
  document(@Param('type') type: string, @Param('id', ParseIntPipe) id: number) {
    return this.fiscal.getDocument(this.type(type), id);
  }

  @Get(':type/:id/eventos')
  events(@Param('type') type: string, @Param('id', ParseIntPipe) id: number) {
    return this.fiscal.getEvents(this.type(type), id);
  }

  @Post(':type/:id/timbrar')
  @Permissions('fiscal.timbrar')
  stamp(@Param('type') type: string, @Param('id', ParseIntPipe) id: number,
    @Req() req: { user: JwtPayload }) {
    return this.fiscal.stamp(this.type(type), id, req.user?.idUser);
  }

  @Get(':type/:id/xml')
  async xml(@Param('type') type: string, @Param('id', ParseIntPipe) id: number, @Res() response: Response) {
    const documentType = this.type(type);
    const xml = await this.fiscal.xml(documentType, id);
    response.set({ 'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename=${documentType}_${id}.xml` });
    response.send(xml);
  }

  @Get(':type/:id/acuse')
  async acknowledgement(@Param('type') type: string, @Param('id', ParseIntPipe) id: number,
    @Res() response: Response) {
    const documentType = this.type(type);
    const xml = await this.fiscal.acknowledgement(documentType, id);
    response.set({ 'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename=ACUSE_${documentType}_${id}.xml` });
    response.send(xml);
  }

  private type(value: string): FiscalDocumentType {
    if (value === 'facturas') return 'FACTURA';
    if (value === 'reps') return 'REP';
    throw new NotFoundException('Tipo de documento fiscal no soportado');
  }
}
