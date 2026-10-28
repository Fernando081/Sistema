import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { createZip, ZipEntry } from '../common/zip';
import { DocumentosVentaService } from './documentos-venta.service';

export const MAX_FACTURAS_LOTE = 100;

interface FacturaLoteRow {
  id: number;
  serie: string | null;
  folio: number | string | null;
  tipo: string | null;
  xml: string | null;
}

/** "1,2,3" → ids únicos y válidos; el lote se limita para no generar archivos enormes en memoria. */
export function parseIdsLote(value: string | undefined): number[] {
  const ids = [...new Set((value ?? '').split(',').map((x) => x.trim()).filter(Boolean).map(Number))];
  if (!ids.length) throw new BadRequestException('Selecciona al menos una factura');
  if (ids.some((id) => !Number.isSafeInteger(id) || id < 1)) throw new BadRequestException('Identificadores de factura inválidos');
  if (ids.length > MAX_FACTURAS_LOTE) throw new BadRequestException(`Máximo ${MAX_FACTURAS_LOTE} facturas por descarga`);
  return ids;
}

/** U02.3 · Descarga en un ZIP del PDF y, si existe, el XML timbrado de varias facturas. */
@Injectable()
export class DescargasVentaService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly documentos: DocumentosVentaService,
  ) {}

  async zipFacturas(ids: number[]): Promise<{ zip: Buffer; incluidas: number }> {
    const rows = await queryRows<FacturaLoteRow>(this.dataSource,
      `SELECT f.id_factura AS id, f.serie, f.folio, f.tipo_comprobante AS tipo, d.xml_timbrado AS xml
         FROM factura f LEFT JOIN fiscal_documento d ON d.id_factura = f.id_factura
        WHERE f.id_factura = ANY($1::int[]) ORDER BY f.id_factura`, [ids]);
    if (!rows.length) throw new NotFoundException('No se encontraron las facturas seleccionadas');
    const entries: ZipEntry[] = [];
    const sinXml: string[] = [];
    for (const row of rows) {
      // Nombre legible y único: serie+folio y el id interno (dos facturas pueden compartir folio entre series).
      const folio = `${row.serie ?? ''}${row.folio ?? ''}`.replace(/[^A-Za-z0-9_-]/g, '') || 'SINFOLIO';
      const base = `${row.tipo === 'E' ? 'nota-credito' : 'factura'}_${folio}_${row.id}`;
      entries.push({ name: `${base}.pdf`, data: await this.documentos.generarTicketPdf(row.id) });
      if (row.xml) entries.push({ name: `${base}.xml`, data: Buffer.from(row.xml, 'utf8') });
      else sinXml.push(`${folio} (id ${row.id})`);
    }
    const faltantes = ids.filter((id) => !rows.some((r) => r.id === id));
    const leeme = [
      `Descarga de ${rows.length} documento(s) - ${new Date().toISOString()}`,
      'PDF: representación generada por el sistema. XML: el timbrado guardado, sin modificar.',
      sinXml.length ? `Sin XML timbrado (borrador o modo de pruebas): ${sinXml.join(', ')}` : 'Todas las facturas incluyen XML timbrado.',
      faltantes.length ? `No encontradas: ${faltantes.join(', ')}` : '',
    ].filter(Boolean).join('\r\n');
    entries.push({ name: 'LEEME-descarga.txt', data: Buffer.from(leeme + '\r\n', 'utf8') });
    return { zip: createZip(entries), incluidas: rows.length };
  }
}
