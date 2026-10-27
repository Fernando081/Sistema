import { Module } from '@nestjs/common';
import { PedidoController } from './pedido.controller';
import { PedidoService } from './pedido.service';
import { VentaModule } from '../venta/venta.module';

import { RegistroPedidoService } from './registro-pedido.service';
import { OperacionPedidoService } from './operacion-pedido.service';
import { ReservasPedidoService } from './reservas-pedido.service';
import { ConsultasPedidoService } from './consultas-pedido.service';
import { FacturacionPedidoService } from './facturacion-pedido.service';
import { PersistenciaPedidoService } from './persistencia-pedido.service';
import { EntregaEvidenciaController } from './entrega-evidencia.controller';
import { EntregaEvidenciaService } from './entrega-evidencia.service';
@Module({
  imports: [VentaModule],
  controllers: [PedidoController, EntregaEvidenciaController],
  providers: [
    PedidoService,
    RegistroPedidoService,
    OperacionPedidoService,
    ReservasPedidoService,
    ConsultasPedidoService,
    FacturacionPedidoService,
    PersistenciaPedidoService,
    EntregaEvidenciaService,
  ],
  exports: [PedidoService],
})
export class PedidoModule {}
