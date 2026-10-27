import { Injectable } from '@nestjs/common';
import { CobranzaService } from './cobranza.service';
import { RegistroRepService } from './registro-rep.service';
import { RepPdfService } from './rep-pdf.service';
import { RepXmlService } from './rep-xml.service';
@Injectable()
export class PagoService {
  constructor(
    private readonly cobranza: CobranzaService,
    private readonly rep: RegistroRepService,
    private readonly pdf: RepPdfService,
    private readonly xml: RepXmlService,
  ) {}
  registrarPago(
    ...args: Parameters<CobranzaService['registrarPago']>
  ): ReturnType<CobranzaService['registrarPago']> {
    return this.cobranza.registrarPago(...args);
  }
  getPagosPorFactura(
    ...args: Parameters<CobranzaService['getPagosPorFactura']>
  ): ReturnType<CobranzaService['getPagosPorFactura']> {
    return this.cobranza.getPagosPorFactura(...args);
  }
  getPendientesPorCliente(
    ...args: Parameters<CobranzaService['getPendientesPorCliente']>
  ): ReturnType<CobranzaService['getPendientesPorCliente']> {
    return this.cobranza.getPendientesPorCliente(...args);
  }
  getAllPendientes(
    ...args: Parameters<CobranzaService['getAllPendientes']>
  ): ReturnType<CobranzaService['getAllPendientes']> {
    return this.cobranza.getAllPendientes(...args);
  }
  getPpdPendientesPorCliente(
    ...args: Parameters<CobranzaService['getPpdPendientesPorCliente']>
  ): ReturnType<CobranzaService['getPpdPendientesPorCliente']> {
    return this.cobranza.getPpdPendientesPorCliente(...args);
  }
  registrarRepComplejo(
    ...args: Parameters<RegistroRepService['registrarRepComplejo']>
  ): ReturnType<RegistroRepService['registrarRepComplejo']> {
    return this.rep.registrarRepComplejo(...args);
  }
  getHistorialReps(
    ...args: Parameters<RegistroRepService['getHistorialReps']>
  ): ReturnType<RegistroRepService['getHistorialReps']> {
    return this.rep.getHistorialReps(...args);
  }
  cancelarRep(
    ...args: Parameters<RegistroRepService['cancelarRep']>
  ): ReturnType<RegistroRepService['cancelarRep']> {
    return this.rep.cancelarRep(...args);
  }
  generarRepPdf(
    ...args: Parameters<RepPdfService['generarRepPdf']>
  ): ReturnType<RepPdfService['generarRepPdf']> {
    return this.pdf.generarRepPdf(...args);
  }
  generarRepXml(
    ...args: Parameters<RepXmlService['generarRepXml']>
  ): ReturnType<RepXmlService['generarRepXml']> {
    return this.xml.generarRepXml(...args);
  }
}
