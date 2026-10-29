import { ContabilidadService } from './contabilidad.service';
import { ConciliacionService } from './conciliacion.service';
import { TesoreriaService } from './tesoreria.service';
import { TransferenciasCierresService } from './transferencias-cierres.service';
import { CorteFinancieroService } from './corte-financiero.service';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FinanzasService } from './finanzas.service';
import { FinanzasController } from './finanzas.controller';
import { DpoContableService } from './dpo-contable.service';
import { AjusteProveedoresService } from './ajuste-proveedores.service';
import { Gasto } from './entities/gasto.entity';
import { Saldo } from './entities/saldo.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([Gasto, Saldo]), AuthModule],
  controllers: [FinanzasController],
  providers: [
    AjusteProveedoresService,
    DpoContableService,
    FinanzasService,
    ContabilidadService,
    ConciliacionService,
    TesoreriaService,
    TransferenciasCierresService,
    CorteFinancieroService,
  ],
  exports: [FinanzasService],
})
export class FinanzasModule {}
