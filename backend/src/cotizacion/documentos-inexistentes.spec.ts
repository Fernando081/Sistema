import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CotizacionService } from './cotizacion.service';
import { DocumentosVentaService } from '../venta/documentos-venta.service';
import { TicketService } from '../venta/ticket.service';

describe('Descargas de documentos inexistentes', () => {
  it.each([
    { rows: [] },
    { rows: [{ datos: null }] },
    { rows: [{ datos: { folio: null } }] },
  ])(
    'devuelve 404 antes de generar PDF con proyección vacía %j',
    async ({ rows }) => {
      const query = jest.fn().mockResolvedValue(rows);
      const source = { query } as unknown as DataSource;
      const ticket = { crearPdfFactura: jest.fn() } as unknown as TicketService;
      await expect(
        new CotizacionService(source).generarPdf(999),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        new DocumentosVentaService(source, ticket).generarTicketPdf(999),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(ticket.crearPdfFactura).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(2);
    },
  );
});
