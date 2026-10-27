// backend/src/cotizacion/cotizacion.module.ts
import { Module } from '@nestjs/common';
import { CotizacionService } from './cotizacion.service';
import { CotizacionController } from './cotizacion.controller';
import { AuthModule } from '../auth/auth.module';
import { CotizacionVersionService } from './cotizacion-version.service';
import { CotizacionVersionController, CotizacionRespuestaController } from './cotizacion-version.controller';

@Module({
  imports: [AuthModule],
  providers: [CotizacionService,CotizacionVersionService],
  controllers: [CotizacionController,CotizacionVersionController,CotizacionRespuestaController],
})
export class CotizacionModule {}
