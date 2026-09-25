import { Module } from '@nestjs/common';
import { PedidoController } from './pedido.controller';
import { PedidoService } from './pedido.service';
import { VentaModule } from '../venta/venta.module';

@Module({ imports: [VentaModule], controllers: [PedidoController], providers: [PedidoService], exports: [PedidoService] })
export class PedidoModule {}
