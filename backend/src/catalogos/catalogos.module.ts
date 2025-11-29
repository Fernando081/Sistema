// backend/src/catalogos/catalogos.module.ts (REEMPLAZAR)

import { Module } from '@nestjs/common';

// Importamos todos los submódulos que acabamos de crear
import { RegimenFiscalModule } from './regimen-fiscal/regimen-fiscal.module';
import { FormaPagoModule } from './forma-pago/forma-pago.module';
import { MetodoPagoModule } from './metodo-pago/metodo-pago.module';
import { UsoCfdiModule } from './uso-cfdi/uso-cfdi.module';
import { EstadoModule } from './estado/estado.module';
import { MunicipioModule } from './municipio/municipio.module';
import { ObjetoImpuestoModule } from './objeto-impuesto/objeto-impuesto.module';
import { UnidadModule } from './unidad/unidad.module';
import { ClaveProdServModule } from './clave-prod-serv/clave-prod-serv.module';
import { ClaveUnidadModule } from './clave-unidad/clave-unidad.module';

@Module({
  imports: [
    RegimenFiscalModule,
    FormaPagoModule,
    MetodoPagoModule,
    UsoCfdiModule,
    EstadoModule,
    MunicipioModule,
    ClaveProdServModule,
    ClaveUnidadModule,
    UnidadModule,
    ObjetoImpuestoModule,
    // ... etc

  ],
  exports: [
    // Opcional: Exportamos los módulos si otros módulos del sistema
    // necesitaran importar CatalogosModule para usar sus servicios.
    RegimenFiscalModule,
    FormaPagoModule,
    MetodoPagoModule,
    UsoCfdiModule,
    EstadoModule,
    MunicipioModule,
    ClaveProdServModule,
    ClaveUnidadModule,
    UnidadModule,
    ObjetoImpuestoModule,
    // ... etc
  ],
})
export class CatalogosModule {}