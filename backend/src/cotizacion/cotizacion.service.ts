// backend/src/cotizacion/cotizacion.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateCotizacionDto, ConvertirCotizacionDto } from './cotizacion.dto';
import { TDocumentDefinitions } from 'pdfmake/interfaces';
import PdfPrinter from 'pdfmake';
import { queryRows } from '../common/database/typed-query';
import { consumeCommercialAuthorizations, validateCommercialPolicy } from '../comercial/commercial-policy';

interface ProductoFiscalRow { id: number; objeto: string; iva: string | number; retiene: boolean; }
interface IdRow { id: number; }
interface CountRow { count: string | number; }
interface CotizacionRow {
  id_cliente: number;
  rfc_receptor: string;
  nombre_receptor: string;
  folio: string | number;
  estatus: string;
  [key: string]: unknown;
}
interface ConceptoCotizacionRow {
  id_concepto: number;
  id_producto: number;
  descripcion: string;
  cantidad: number | string;
  estatus: string;
  Existencia: number | string;
  ObjetoImpuesto: string;
  TasaIVA: number | string;
  importe_ret_isr: number | string;
  clave_prod_serv: string;
  clave_unidad: string;
  unidad: string;
}
interface FolioRow { next_folio: number | string; }
interface ClienteCpRow { cp: string | null; }
interface FacturaIdRow { id_factura: number; }
interface EstadoConceptosRow { total: number; compradas: number; }
interface CotizacionPdfConcepto { cantidad: number; descripcion: string; precio: number | string; importe: number | string; }
interface CotizacionPdfData {
  folio: string | number;
  fecha: string;
  vencimiento: string;
  cliente: { nombre: string; rfc: string };
  conceptos: CotizacionPdfConcepto[];
  subtotal: number | string;
  iva: number | string;
  retenciones: number | string;
  total: number | string;
}
interface CotizacionPdfRow { datos: CotizacionPdfData; }

@Injectable()
export class CotizacionService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async create(dto: CreateCotizacionDto) {
    return this.dataSource.transaction(async manager => {
    const ids = [...new Set(dto.conceptos.map((c) => c.idProducto))];
    const products = await queryRows<ProductoFiscalRow>(manager,
      `SELECT "IdProducto" AS id, "ObjetoImpuesto" AS objeto,
              "TasaIVA" AS iva, "AplicaRetencionISR" AS retiene
         FROM producto WHERE "IdProducto" = ANY($1::int[])`, [ids],
    );
    if (products.length !== ids.length) throw new BadRequestException('Uno o más productos no existen');
    const productMap = new Map(products.map((p) => [Number(p.id), p]));
    const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const conceptos = dto.conceptos.map((c) => {
      const p = productMap.get(c.idProducto);
      if (!p) throw new BadRequestException(`Producto ${c.idProducto} no encontrado`);
      const importe = money(c.cantidad * c.valorUnitario);
      return { ...c, importe,
        importeIva: p.objeto === '02' ? money(importe * Number(p.iva)) : 0,
        importeRetIsr: p.retiene && dto.rfcReceptor.trim().length === 12 ? money(importe * 0.0125) : 0 };
    });
    const subtotal = money(conceptos.reduce((s, c) => s + c.importe, 0));
    const iva = money(conceptos.reduce((s, c) => s + c.importeIva, 0));
    const retenciones = money(conceptos.reduce((s, c) => s + c.importeRetIsr, 0));
    const total = money(subtotal + iva - retenciones);
    if ([dto.subtotal - subtotal, dto.totalImpuestos - iva, dto.totalRetenciones - retenciones, dto.total - total]
      .some((difference) => Math.abs(difference) > 0.01)) {
      throw new BadRequestException('Los totales de la cotización no coinciden con el cálculo del servidor');
    }
    const json = JSON.stringify(conceptos);
    await validateCommercialPolicy(manager, {
      idCliente: dto.idCliente,
      total,
      validarCredito: false,
      lineas: conceptos.map((line) => ({
        idProducto: line.idProducto,
        cantidad: Number(line.cantidad),
        precio: Number(line.valorUnitario),
      })),
    });
    const result = await queryRows<IdRow>(manager,
      `SELECT fn_crear_cotizacion($1, $2, $3, $4, $5, $6, $7, $8) as id`,
      [
        dto.idCliente,
        dto.nombreReceptor,
        dto.rfcReceptor,
        subtotal,
        iva,
        retenciones,
        total,
        json,
      ],
    );
    return { message: 'Cotización creada', id: result[0].id };
    });
  }

  async findAll(page: number = 1, limit: number = 10, term: string = ''): Promise<{ data: Record<string, unknown>[], total: number, page: number, totalPages: number }> {
    page = Math.max(1, page);
    limit = Math.min(100, Math.max(1, limit));
    const offset = (page - 1) * limit;

    const [totalResult, dataResult] = await Promise.all([
      queryRows<CountRow>(this.dataSource, 'SELECT COUNT(*) as count FROM fn_get_cotizaciones(NULL, NULL, $1)', [term]),
      queryRows<Record<string, unknown>>(this.dataSource,
        `SELECT f.*,pv.id_pedido
           FROM fn_get_cotizaciones($1, $2, $3) f
           LEFT JOIN pedido_venta pv ON pv.id_cotizacion=f.id_cotizacion`,
        [limit, offset, term]
      ),
    ]);


    const total = Number(totalResult[0].count);
    const totalPages = Math.ceil(total / limit);

    return {
      data: dataResult,
      total,
      page,
      totalPages,
    };
  }

  async findOne(idCotizacion: number) {
    const cabecera = await queryRows<CotizacionRow>(this.dataSource, `SELECT * FROM cotizacion WHERE id_cotizacion = $1`, [idCotizacion]);
    if (!cabecera.length) throw new BadRequestException('Cotización no encontrada');
    const conceptos = await queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT cc.id_concepto, cc.id_producto, cc.descripcion, cc.cantidad,
             cc.estatus, cc.motivo_rechazo, cc.precio_cierre,
             cc.valor_unitario as precio, p."Existencia" as stock
      FROM conceptocotizacion cc
      JOIN producto p ON p."IdProducto" = cc.id_producto
      WHERE cc.id_cotizacion = $1
    `, [idCotizacion]);

    return { ...cabecera[0], conceptos };
  }

  async convertirParcial(
    idCotizacion: number,
    dto: ConvertirCotizacionDto,
    idFormaPago: number,
    idMetodoPago: number,
    idVendedor?: number,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Extraer cabecera para re-calcular impuestos de los confirmados
      const cRows = await queryRows<CotizacionRow>(queryRunner,
        `SELECT * FROM cotizacion WHERE id_cotizacion = $1 FOR UPDATE`,
        [idCotizacion],
      );
      if (cRows.length === 0) throw new BadRequestException('Cotización no encontrada');
      const cot = cRows[0];
      if (cot.estatus === 'Convertida' || cot.estatus === 'Rechazada') {
        throw new BadRequestException('La cotización ya fue cerrada o convertida anteriormente.');
      }

      const acceptedIds = dto.articulosAceptados.map((item) => item.idConcepto);
      const rejectedIds = dto.articulosRechazados.map((item) => item.idConcepto);
      const allIds = [...acceptedIds, ...rejectedIds];
      if (!allIds.length) {
        throw new BadRequestException('Selecciona al menos un artículo para procesar');
      }
      if (new Set(allIds).size !== allIds.length) {
        throw new BadRequestException('Hay artículos repetidos o con decisiones contradictorias');
      }

      const selectedRows = await queryRows<ConceptoCotizacionRow>(queryRunner, `
        SELECT cc.*, p."ObjetoImpuesto", p."TasaIVA",
               cps."Clave" as clave_prod_serv, cu."Clave" as clave_unidad,
               p."Existencia"
          FROM conceptocotizacion cc
          JOIN producto p ON cc.id_producto = p."IdProducto"
          LEFT JOIN claveproductooservicio cps ON p."IdClaveProdOServ" = cps."IdClaveProdOServ"
          LEFT JOIN claveunidad cu ON p."IdClaveUnidad" = cu."IdClaveUnidad"
         WHERE cc.id_cotizacion = $1 AND cc.id_concepto = ANY($2::int[])
         ORDER BY cc.id_producto
         FOR UPDATE OF cc, p
      `, [idCotizacion, allIds]);
      if (selectedRows.length !== allIds.length) {
        throw new BadRequestException('Uno o más artículos no pertenecen a esta cotización');
      }
      if (selectedRows.some((row) => row.estatus !== 'Pendiente')) {
        throw new BadRequestException('Solo se pueden procesar renglones pendientes de la cotización');
      }
      const selectedMap = new Map<number, ConceptoCotizacionRow>(
        selectedRows.map((row) => [Number(row.id_concepto), row]),
      );

      // 2. Procesar (Win/Loss Tracking)
      // RECHAZADOS
      if (dto.articulosRechazados && dto.articulosRechazados.length > 0) {
        for (const rec of dto.articulosRechazados) {
          await queryRunner.query(
            `UPDATE conceptocotizacion SET estatus = 'Rechazada', motivo_rechazo = $1 WHERE id_cotizacion = $2 AND id_concepto = $3`,
            [rec.motivoRechazo, idCotizacion, rec.idConcepto]
          );
        }
      }

      const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      const requested = new Map<number, number>();
      for (const accepted of dto.articulosAceptados) {
        const row = selectedMap.get(accepted.idConcepto);
        if (!row) throw new BadRequestException('El artículo aceptado no pertenece a la cotización');
        const quantity = (requested.get(Number(row.id_producto)) || 0) + Number(row.cantidad);
        requested.set(Number(row.id_producto), quantity);
        if (quantity > Number(row.Existencia)) {
          throw new BadRequestException(`Stock insuficiente para el producto "${row.descripcion}"`);
        }
      }
      let nuevoSubtotal = 0;
      let nuevoIva = 0;
      let nuevoRetIsr = 0;
      const conceptosAceptadosJson: Record<string, unknown>[] = [];

      // ACEPTADOS
      if (dto.articulosAceptados && dto.articulosAceptados.length > 0) {
        for (const acep of dto.articulosAceptados) {
          await queryRunner.query(
            `UPDATE conceptocotizacion SET estatus = 'Comprada', precio_cierre = $1 WHERE id_cotizacion = $2 AND id_concepto = $3`,
            [acep.precioCierre, idCotizacion, acep.idConcepto]
          );

          const c = selectedMap.get(acep.idConcepto);
          if (!c) throw new BadRequestException('El artículo aceptado no pertenece a la cotización');

          if (Number(c.Existencia) < Number(c.cantidad)) {
            throw new BadRequestException(`Stock insuficiente para el producto "${c.descripcion}". Tiene ${c.Existencia} pero requiere ${c.cantidad}.`);
          }

          const importeLinea = money(Number(acep.precioCierre) * Number(c.cantidad));
          nuevoSubtotal += importeLinea;

          let importeIvaLinea = 0;
          if (c.ObjetoImpuesto === '02' && Number(c.TasaIVA) > 0) {
            importeIvaLinea = money(importeLinea * Number(c.TasaIVA));
            nuevoIva += importeIvaLinea;
          }

          let importeRetIsrLinea = 0;
          if (Number(c.importe_ret_isr) > 0) {
            importeRetIsrLinea = money(importeLinea * 0.0125);
            nuevoRetIsr += importeRetIsrLinea;
          }

          conceptosAceptadosJson.push({
            idProducto: c.id_producto,
            cantidad: c.cantidad,
            valorUnitario: acep.precioCierre,
            importe: importeLinea,
            descuento: 0,
            claveProdServ: c.clave_prod_serv,
            claveUnidad: c.clave_unidad,
            objetoImpuesto: c.ObjetoImpuesto,
            descripcion: c.descripcion,
            unidadDescripcion: c.unidad,
            baseIva: c.ObjetoImpuesto === '02' ? importeLinea : 0,
            tasaIva: c.ObjetoImpuesto === '02' ? c.TasaIVA : 0,
            importeIva: importeIvaLinea,
            baseRetIsr: importeLinea,
            tasaRetIsr: importeRetIsrLinea > 0 ? 0.0125 : 0,
            importeRetIsr: importeRetIsrLinea
          });
        }
      }

      nuevoSubtotal = money(nuevoSubtotal);
      nuevoIva = money(nuevoIva);
      nuevoRetIsr = money(nuevoRetIsr);
      const nuevoTotal = money(nuevoSubtotal + nuevoIva - nuevoRetIsr);
      let idFactura: number | null = null;

      if (conceptosAceptadosJson.length > 0) {
        const commercialAuthorizationIds = await validateCommercialPolicy(queryRunner, {
          idCliente: cot.id_cliente,
          idMetodoPago,
          total: nuevoTotal,
          validarCredito: true,
          lineas: conceptosAceptadosJson.map((line) => ({
            idProducto: Number(line.idProducto),
            cantidad: Number(line.cantidad),
            precio: Number(line.valorUnitario),
          })),
        });
        await queryRunner.query(`SELECT pg_advisory_xact_lock(hashtext('factura-folio:' || $1))`, ['A']);
        const folios = await queryRows<FolioRow>(queryRunner,
          `SELECT COALESCE(MAX(folio), 0) + 1 AS next_folio FROM factura WHERE serie = $1`, ['A'],
        );
        const clients = await queryRows<ClienteCpRow>(queryRunner, `SELECT "CodigoPostal" AS cp FROM cliente WHERE "IdCliente"=$1`, [cot.id_cliente]);
        // Lanzamos el fn_crear_venta interno con los nuevos recalculos
        const v = await queryRows<FacturaIdRow>(queryRunner,
          `SELECT fn_crear_venta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) as id_factura`,
          [
            cot.id_cliente,
            cot.rfc_receptor,
            cot.nombre_receptor,
            clients[0]?.cp || '00000', '616', 'G03', idFormaPago, idMetodoPago, 'MXN', 1,
            nuevoSubtotal,
            nuevoIva,
            nuevoRetIsr,
            nuevoTotal,
            'Venta parcial de Cotización C-' + cot.folio,
            JSON.stringify(conceptosAceptadosJson),
            idVendedor || null, Number(folios[0].next_folio), 'A', 'I'
          ]
        );
        idFactura = v[0].id_factura;
        await consumeCommercialAuthorizations(queryRunner, commercialAuthorizationIds, 'Venta', idFactura);
        
        // Win/Loss Constraint CRM Binding
        await queryRunner.query(`UPDATE factura SET id_cotizacion = $1 WHERE id_factura = $2`, [idCotizacion, idFactura]);
      }

      const pendingRows = await queryRows<EstadoConceptosRow>(queryRunner,
        `SELECT COUNT(*) FILTER (WHERE estatus = 'Pendiente')::int AS total,
                COUNT(*) FILTER (WHERE estatus = 'Comprada')::int AS compradas
           FROM conceptocotizacion
          WHERE id_cotizacion = $1`,
        [idCotizacion],
      );
      const hasPending = Number(pendingRows[0].total) > 0;
      const finalStatus = hasPending
        ? 'Pendiente'
        : Number(pendingRows[0].compradas) > 0
          ? 'Convertida'
          : 'Rechazada';
      await queryRunner.query(
        `UPDATE cotizacion SET estatus = $1 WHERE id_cotizacion = $2`,
        [finalStatus, idCotizacion],
      );
      await queryRunner.commitTransaction();

      return {
        message: 'Cotización procesada exitosamente (Win/Loss Tracking completo)',
        idFactura
      };

    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // --- GENERAR PDF COTIZACIÓN ---
  async generarPdf(id: number): Promise<Buffer> {
    const res = await queryRows<CotizacionPdfRow>(this.dataSource,
      'SELECT fn_get_datos_cotizacion_pdf($1) as datos',
      [id],
    );
    const datos = res[0].datos;

    const fonts = {
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    };
    const printer = new PdfPrinter(fonts);

    const docDefinition: TDocumentDefinitions = {
      pageSize: 'LETTER', // Tamaño carta para cotizaciones
      pageMargins: [40, 40, 40, 40],
      defaultStyle: { font: 'Helvetica', fontSize: 10 },
      content: [
        {
          text: 'COTIZACIÓN',
          style: 'header',
          alignment: 'right',
          color: '#555',
        },
        { text: `Folio: ${datos.folio}`, alignment: 'right', bold: true },
        { text: `Fecha: ${datos.fecha}`, alignment: 'right' },
        {
          text: `Vence: ${datos.vencimiento}`,
          alignment: 'right',
          color: 'red',
          fontSize: 9,
        },

        { text: 'Refacciones y Tractorepuestos', style: 'empresa' },
        { text: 'Miramar, Tamaulipas', margin: [0, 0, 0, 20] },

        { text: 'ATENCIÓN A:', bold: true },
        { text: datos.cliente.nombre, fontSize: 12 },
        { text: `RFC: ${datos.cliente.rfc}`, margin: [0, 0, 0, 20] },

        // Tabla de Conceptos
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', 'auto', 'auto'],
            body: [
              [
                { text: 'CANT', style: 'tableHeader' },
                { text: 'DESCRIPCIÓN', style: 'tableHeader' },
                { text: 'P. UNIT', style: 'tableHeader' },
                { text: 'IMPORTE', style: 'tableHeader' },
              ],
              ...datos.conceptos.map((p) => [
                p.cantidad,
                p.descripcion,
                `$${Number(p.precio).toFixed(2)}`,
                `$${Number(p.importe).toFixed(2)}`,
              ]),
            ],
          },
          layout: 'lightHorizontalLines',
        },

        // Totales
        {
          margin: [0, 20, 0, 0],
          table: {
            widths: ['*', 'auto'],
            body: [
              [
                { text: 'Subtotal:', alignment: 'right' },
                {
                  text: `$${Number(datos.subtotal).toFixed(2)}`,
                  alignment: 'right',
                },
              ],
              [
                { text: 'IVA:', alignment: 'right' },
                {
                  text: `$${Number(datos.iva).toFixed(2)}`,
                  alignment: 'right',
                },
              ],
              [
                { text: 'Retenciones:', alignment: 'right' },
                {
                  text: `-$${Number(datos.retenciones).toFixed(2)}`,
                  alignment: 'right',
                },
              ],
              [
                {
                  text: 'TOTAL:',
                  alignment: 'right',
                  bold: true,
                  fontSize: 14,
                },
                {
                  text: `$${Number(datos.total).toFixed(2)}`,
                  alignment: 'right',
                  bold: true,
                  fontSize: 14,
                },
              ],
            ],
          },
          layout: 'noBorders',
        },
      ],
      styles: {
        header: { fontSize: 22, bold: true },
        empresa: { fontSize: 16, bold: true, color: '#005fcc' },
        tableHeader: {
          bold: true,
          fontSize: 10,
          color: 'black',
          fillColor: '#eeeeee',
        },
      },
    };

    const doc = printer.createPdfKitDocument(docDefinition);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err: Error) => reject(err));
      doc.end();
    });
  }
}
