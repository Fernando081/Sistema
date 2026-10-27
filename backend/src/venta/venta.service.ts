import { FacturaQueryDto } from './factura-query';
import { Injectable } from '@nestjs/common';
import { RegistroVentaService } from './registro-venta.service';
import { ConsultasVentaService } from './consultas-venta.service';
import { DocumentosVentaService } from './documentos-venta.service';
import { ReversionVentaService } from './reversion-venta.service';
import { FacturaGlobalService } from './factura-global.service';
export type { TicketResumenRow } from './venta.types';
@Injectable()
export class VentaService {
  constructor(
    private readonly registro: RegistroVentaService,
    private readonly consultas: ConsultasVentaService,
    private readonly documentos: DocumentosVentaService,
    private readonly reversion: ReversionVentaService,
    private readonly global: FacturaGlobalService,
  ) {}
  create(
    ...args: Parameters<RegistroVentaService['create']>
  ): ReturnType<RegistroVentaService['create']> {
    return this.registro.create(...args);
  }
  getFacturasRelacionables(
    ...args: Parameters<ConsultasVentaService['getFacturasRelacionables']>
  ): ReturnType<ConsultasVentaService['getFacturasRelacionables']> {
    return this.consultas.getFacturasRelacionables(...args);
  }
  getComisionesSemanales(
    ...args: Parameters<ConsultasVentaService['getComisionesSemanales']>
  ): ReturnType<ConsultasVentaService['getComisionesSemanales']> {
    return this.consultas.getComisionesSemanales(...args);
  }
  exportCsv(query: FacturaQueryDto) { return this.consultas.exportCsv(query); }

  findAll(
    ...args: Parameters<ConsultasVentaService['findAll']>
  ): ReturnType<ConsultasVentaService['findAll']> {
    return this.consultas.findAll(...args);
  }
  findDetalle(
    ...args: Parameters<ConsultasVentaService['findDetalle']>
  ): ReturnType<ConsultasVentaService['findDetalle']> {
    return this.consultas.findDetalle(...args);
  }
  generarTicketPdf(
    ...args: Parameters<DocumentosVentaService['generarTicketPdf']>
  ): ReturnType<DocumentosVentaService['generarTicketPdf']> {
    return this.documentos.generarTicketPdf(...args);
  }
  cancelarFactura(
    ...args: Parameters<ReversionVentaService['cancelarFactura']>
  ): ReturnType<ReversionVentaService['cancelarFactura']> {
    return this.reversion.cancelarFactura(...args);
  }
  procesarDevolucion(
    ...args: Parameters<ReversionVentaService['procesarDevolucion']>
  ): ReturnType<ReversionVentaService['procesarDevolucion']> {
    return this.reversion.procesarDevolucion(...args);
  }
  getTicketsPendientesGlobal(
    ...args: Parameters<FacturaGlobalService['getTicketsPendientesGlobal']>
  ): ReturnType<FacturaGlobalService['getTicketsPendientesGlobal']> {
    return this.global.getTicketsPendientesGlobal(...args);
  }
  generarFacturaGlobal(
    ...args: Parameters<FacturaGlobalService['generarFacturaGlobal']>
  ): ReturnType<FacturaGlobalService['generarFacturaGlobal']> {
    return this.global.generarFacturaGlobal(...args);
  }
}
