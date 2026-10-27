// backend/src/pago/pago.module.ts
import { Module } from '@nestjs/common';
import { PagoService } from './pago.service';
import { PagoController } from './pago.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pago } from './pago.entity';
import { FiscalModule } from '../fiscal/fiscal.module';

import { CobranzaService } from './cobranza.service';
import { RegistroRepService } from './registro-rep.service';
import { RepPdfService } from './rep-pdf.service';
import { RepXmlService } from './rep-xml.service';
@Module({
  imports: [TypeOrmModule.forFeature([Pago]), FiscalModule],
  providers: [
    PagoService,
    CobranzaService,
    RegistroRepService,
    RepPdfService,
    RepXmlService,
  ],
  controllers: [PagoController],
})
export class PagoModule {}
