import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TicketService } from './ticket.service';
import { QueryExecutor, queryRows } from '../common/database/typed-query';
import { DatosTicketFactura, TicketQueryResult } from './ticket.types';
import { PdfFiscalRow } from './venta.types';
@Injectable()
export class DocumentosVentaService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ticketService: TicketService,
  ) {}
  async datosPdf(idFactura: number, db:QueryExecutor=this.dataSource) {
    const resultado = await queryRows<TicketQueryResult>(
      db,
      'SELECT fn_get_datos_ticket($1) as datos',
      [idFactura],
    );
    if (!resultado[0]?.datos || resultado[0].datos.folio == null)
      throw new NotFoundException('Factura no encontrada');
    const fiscal = await queryRows<PdfFiscalRow>(
      db,
      `
      SELECT ambiente,estado,uuid,fecha_timbrado,no_certificado_cfdi,no_certificado_sat,
        sello_cfdi,sello_sat,cadena_original_sat FROM fiscal_documento WHERE id_factura=$1`,
      [idFactura],
    );
    const document = fiscal[0];
    resultado[0].datos.fiscal = {
      environment: document?.ambiente || 'mock',
      state: document?.estado || 'Borrador',
      uuid: document?.uuid || undefined,
      stampedAt: document?.fecha_timbrado
        ? String(document.fecha_timbrado)
        : undefined,
      issuerRfc: process.env.FISCAL_ISSUER_RFC || 'RFC NO CONFIGURADO',
      issuerName: process.env.FISCAL_ISSUER_NAME || 'EMISOR NO CONFIGURADO',
      issuerTaxRegime: process.env.FISCAL_ISSUER_TAX_REGIME || 'N/A',
      issuerPostalCode: process.env.FISCAL_ISSUER_POSTAL_CODE || 'N/A',
      cfdiCertificate: document?.no_certificado_cfdi || undefined,
      satCertificate: document?.no_certificado_sat || undefined,
      cfdiSeal: document?.sello_cfdi || undefined,
      satSeal: document?.sello_sat || undefined,
      satOriginalString: document?.cadena_original_sat || undefined,
    };
    return resultado[0].datos;
  }

  async generarTicketPdf(idFactura:number,db:QueryExecutor=this.dataSource):Promise<Buffer>{
    return this.renderPdf(await this.datosPdf(idFactura,db));
  }
  renderPdf(datos:DatosTicketFactura):Promise<Buffer>{return this.ticketService.crearPdfFactura(datos);}
}
