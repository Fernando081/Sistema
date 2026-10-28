import { Injectable } from '@nestjs/common';
import { FacturasProveedorService } from './facturas-proveedor.service';
import { PagosProveedorService } from './pagos-proveedor.service';
import { SaldosProveedorService } from './saldos-proveedor.service';
import { ConsultasProveedorService } from './consultas-proveedor.service';
@Injectable()
export class CuentasProveedorService {
  constructor(
    private readonly facturas: FacturasProveedorService,
    private readonly pagos: PagosProveedorService,
    private readonly saldos: SaldosProveedorService,
    private readonly consultas: ConsultasProveedorService,
  ) {}
  createInvoice(
    ...args: Parameters<FacturasProveedorService['createInvoice']>
  ): ReturnType<FacturasProveedorService['createInvoice']> {
    return this.facturas.createInvoice(...args);
  }
  uploadPdf(
    ...args: Parameters<FacturasProveedorService['uploadPdf']>
  ): ReturnType<FacturasProveedorService['uploadPdf']> {
    return this.facturas.uploadPdf(...args);
  }
  document(
    ...args: Parameters<FacturasProveedorService['document']>
  ): ReturnType<FacturasProveedorService['document']> {
    return this.facturas.document(...args);
  }
  resolveDiscrepancy(
    ...args: Parameters<FacturasProveedorService['resolveDiscrepancy']>
  ): ReturnType<FacturasProveedorService['resolveDiscrepancy']> {
    return this.facturas.resolveDiscrepancy(...args);
  }
  approveInvoice(
    ...args: Parameters<FacturasProveedorService['approveInvoice']>
  ): ReturnType<FacturasProveedorService['approveInvoice']> {
    return this.facturas.approveInvoice(...args);
  }
  cancelInvoice(
    ...args: Parameters<FacturasProveedorService['cancelInvoice']>
  ): ReturnType<FacturasProveedorService['cancelInvoice']> {
    return this.facturas.cancelInvoice(...args);
  }
  schedule(
    ...args: Parameters<PagosProveedorService['schedule']>
  ): ReturnType<PagosProveedorService['schedule']> {
    return this.pagos.schedule(...args);
  }
  pay(
    ...args: Parameters<PagosProveedorService['pay']>
  ): ReturnType<PagosProveedorService['pay']> {
    return this.pagos.pay(...args);
  }
  payGrouped(
    ...args: Parameters<PagosProveedorService['payGrouped']>
  ): ReturnType<PagosProveedorService['payGrouped']> {
    return this.pagos.payGrouped(...args);
  }
  reversePayment(
    ...args: Parameters<PagosProveedorService['reversePayment']>
  ): ReturnType<PagosProveedorService['reversePayment']> {
    return this.pagos.reversePayment(...args);
  }
  createCredit(
    ...args: Parameters<SaldosProveedorService['createCredit']>
  ): ReturnType<SaldosProveedorService['createCredit']> {
    return this.saldos.createCredit(...args);
  }
  createAdvance(
    ...args: Parameters<SaldosProveedorService['createAdvance']>
  ): ReturnType<SaldosProveedorService['createAdvance']> {
    return this.saldos.createAdvance(...args);
  }
  listInvoices(
    ...args: Parameters<ConsultasProveedorService['listInvoices']>
  ): ReturnType<ConsultasProveedorService['listInvoices']> {
    return this.consultas.listInvoices(...args);
  }
  invoice(
    ...args: Parameters<ConsultasProveedorService['invoice']>
  ): ReturnType<ConsultasProveedorService['invoice']> {
    return this.consultas.invoice(...args);
  }
  dashboard(
    ...args: Parameters<ConsultasProveedorService['dashboard']>
  ): ReturnType<ConsultasProveedorService['dashboard']> {
    return this.consultas.dashboard(...args);
  }
}
