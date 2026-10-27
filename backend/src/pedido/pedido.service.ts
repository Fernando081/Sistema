import { Injectable } from '@nestjs/common';
import { RegistroPedidoService } from './registro-pedido.service';
import { OperacionPedidoService } from './operacion-pedido.service';
import { ReservasPedidoService } from './reservas-pedido.service';
import { ConsultasPedidoService } from './consultas-pedido.service';
import { FacturacionPedidoService } from './facturacion-pedido.service';
@Injectable()
export class PedidoService {
  constructor(
    private readonly registro: RegistroPedidoService,
    private readonly operacion: OperacionPedidoService,
    private readonly reservas: ReservasPedidoService,
    private readonly consultas: ConsultasPedidoService,
    private readonly facturacion: FacturacionPedidoService,
  ) {}
  create(
    ...args: Parameters<RegistroPedidoService['create']>
  ): ReturnType<RegistroPedidoService['create']> {
    return this.registro.create(...args);
  }
  createFromQuote(
    ...args: Parameters<RegistroPedidoService['createFromQuote']>
  ): ReturnType<RegistroPedidoService['createFromQuote']> {
    return this.registro.createFromQuote(...args);
  }
  confirm(
    ...args: Parameters<OperacionPedidoService['confirm']>
  ): ReturnType<OperacionPedidoService['confirm']> {
    return this.operacion.confirm(...args);
  }
  fulfill(
    ...args: Parameters<OperacionPedidoService['fulfill']>
  ): ReturnType<OperacionPedidoService['fulfill']> {
    return this.operacion.fulfill(...args);
  }
  cancel(
    ...args: Parameters<OperacionPedidoService['cancel']>
  ): ReturnType<OperacionPedidoService['cancel']> {
    return this.operacion.cancel(...args);
  }
  deliver(
    ...args: Parameters<OperacionPedidoService['deliver']>
  ): ReturnType<OperacionPedidoService['deliver']> {
    return this.operacion.deliver(...args);
  }
  releaseExpiredReservations(
    ...args: Parameters<ReservasPedidoService['releaseExpiredReservations']>
  ): ReturnType<ReservasPedidoService['releaseExpiredReservations']> {
    return this.reservas.releaseExpiredReservations(...args);
  }
  findAll(
    ...args: Parameters<ConsultasPedidoService['findAll']>
  ): ReturnType<ConsultasPedidoService['findAll']> {
    return this.consultas.findAll(...args);
  }
  findOne(
    ...args: Parameters<ConsultasPedidoService['findOne']>
  ): ReturnType<ConsultasPedidoService['findOne']> {
    return this.consultas.findOne(...args);
  }
  backorders(
    ...args: Parameters<ConsultasPedidoService['backorders']>
  ): ReturnType<ConsultasPedidoService['backorders']> {
    return this.consultas.backorders(...args);
  }
  expiredReservations(
    ...args: Parameters<ConsultasPedidoService['expiredReservations']>
  ): ReturnType<ConsultasPedidoService['expiredReservations']> {
    return this.consultas.expiredReservations(...args);
  }
  availability(
    ...args: Parameters<ConsultasPedidoService['availability']>
  ): ReturnType<ConsultasPedidoService['availability']> {
    return this.consultas.availability(...args);
  }
  prepareInvoice(
    ...args: Parameters<FacturacionPedidoService['prepareInvoice']>
  ): ReturnType<FacturacionPedidoService['prepareInvoice']> {
    return this.facturacion.prepareInvoice(...args);
  }
}
