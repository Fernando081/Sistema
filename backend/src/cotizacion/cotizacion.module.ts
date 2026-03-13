// backend/src/cotizacion/cotizacion.module.ts
import { Module } from '@nestjs/common';
import { CotizacionService } from './cotizacion.service';
import { CotizacionController } from './cotizacion.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [CotizacionService],
  controllers: [CotizacionController],
})
export class CotizacionModule {}
