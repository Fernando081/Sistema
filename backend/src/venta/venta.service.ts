// backend/src/venta/venta.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateVentaDto, ProcesarDevolucionDto } from './venta.dto';
import * as nodemailer from 'nodemailer';
import { TicketService } from './ticket.service';
import { TicketQueryResult } from './ticket.types';

@Injectable()
export class VentaService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ticketService: TicketService,
  ) {}

  async generarTicketPdf(idFactura: number): Promise<Buffer> {
    const resultado = await this.dataSource.query(
      'SELECT fn_get_datos_ticket($1) as datos',
      [idFactura],
    );

    return this.ticketService.crearPdfFactura(resultado[0].datos);
  }

  async getFacturasRelacionables(idCliente: number) {
    return this.dataSource.query(
      `SELECT id_factura, serie, folio, COALESCE(uuid, '00000000-0000-0000-0000-000000000000') as uuid, fecha_emision, total 
       FROM factura 
       WHERE id_cliente = $1 
       ORDER BY fecha_emision DESC`,
      [idCliente]
    );
  }

  async create(createVentaDto: CreateVentaDto, idVendedor?: number) {
    const conceptosJson = JSON.stringify(createVentaDto.conceptos);
    const queryRunner = this.dataSource.createQueryRunner();

    const tipoComprobante = createVentaDto.tipoComprobante || 'I';
    const serie = createVentaDto.serie || 'A';

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Calcular el folio con MAX(folio) filtrando por serie
      const folioResult = await queryRunner.query(
        'SELECT COALESCE(MAX(folio), 0) + 1 AS next_folio FROM factura WHERE serie = $1',
        [serie]
      );
      const folio = parseInt(folioResult[0].next_folio, 10);

      const result = await queryRunner.query(
        `SELECT fn_crear_venta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) as id_factura`,
        [
          createVentaDto.idCliente,
          createVentaDto.rfcReceptor,
          createVentaDto.nombreReceptor,
          createVentaDto.cpReceptor,
          createVentaDto.regimenReceptor,
          createVentaDto.usoCfdi,
          createVentaDto.idFormaPago,
          createVentaDto.idMetodoPago,
          createVentaDto.moneda,
          createVentaDto.tipoCambio,
          createVentaDto.subtotal,
          createVentaDto.totalImpuestosTrasladados,
          createVentaDto.totalImpuestosRetenidos,
          createVentaDto.total,
          '',
          conceptosJson,
          idVendedor || null,
          folio,
          serie,
          tipoComprobante
        ],
      );

      const idFactura = result[0].id_factura;

      // 2. Insertar cfdi_relacionado si existen
      if (createVentaDto.cfdisRelacionados && createVentaDto.cfdisRelacionados.length > 0) {
        for (const relacion of createVentaDto.cfdisRelacionados) {
          await queryRunner.query(
            `INSERT INTO cfdi_relacionado (id_factura, tipo_relacion, uuid_relacionado) VALUES ($1, $2, $3)`,
            [idFactura, relacion.tipoRelacion, relacion.uuidRelacionado]
          );
        }
      }

      // 3. Lógica Financiera de Reembolso para Egresos
      if (tipoComprobante === 'E' && createVentaDto.metodoReembolso) {
        if (createVentaDto.metodoReembolso === 'Saldo a Favor') {
          await queryRunner.query(
            'UPDATE cliente SET saldo_a_favor = saldo_a_favor + $1 WHERE "IdCliente" = $2',
            [createVentaDto.total, createVentaDto.idCliente]
          );
        } else if (createVentaDto.metodoReembolso === 'Efectivo') {
          await queryRunner.query(
            'INSERT INTO gasto (concepto, monto, categoria, metodo_pago, id_user) VALUES ($1, $2, $3, $4, $5)',
            ['DEVOLUCION EFECTIVO NOTA DE CREDITO ' + serie + '-' + folio, createVentaDto.total, 'Devoluciones y Reembolsos', 'Efectivo', idVendedor || null]
          );
        }
      }

      await queryRunner.commitTransaction();

      return {
        message: 'Venta registrada con éxito',
        idFactura: idFactura,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getComisionesSemanales() {
    return this.dataSource.query('SELECT * FROM fn_get_comisiones_semanales()');
  }

  async findAll(page: number = 1, limit: number = 10, term: string = '', tipo: string = '') {
    const offset = (page - 1) * limit;

    console.log(`[VentaService] findAll args: page=${page}, limit=${limit}, term='${term}', tipo='${tipo}'`);

    const [totalResult, dataResult] = await Promise.all([
      this.dataSource.query('SELECT COUNT(*) as count FROM fn_get_facturas(NULL, NULL, $1, $2)', [term, tipo]),
      this.dataSource.query(
        'SELECT * FROM fn_get_facturas($1, $2, $3, $4)',
        [limit, offset, term, tipo]
      ),
    ]);

    console.log(`[VentaService] Data query returned ${dataResult?.length} rows`);

    const total = parseInt(totalResult[0].count, 10);
    const totalPages = Math.ceil(total / limit);

    return {
      data: dataResult,
      total,
      page,
      totalPages,
    };
  }


  async findDetalle(idFactura: number) {
    return this.dataSource.query('SELECT * FROM fn_get_detalle_factura($1)', [
      idFactura,
    ]);
  }

  async enviarFacturaPorCorreo(idFactura: number) {
    const res = await this.dataSource.query(
      'SELECT * FROM fn_preparar_envio_correo($1)',
      [idFactura],
    );
    if (!res || res.length === 0)
      throw new Error('Error al obtener datos de envío.');
    const datosEnvio = res[0];
    const pdfBuffer = await this.generarTicketPdf(idFactura);
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: '"Refacciones y Tractorepuestos" <dusk081.eth@gmail.com>',
      to: datosEnvio.destinatario,
      subject: datosEnvio.asunto,
      text: datosEnvio.cuerpo_mensaje,
      attachments: [
        { filename: datosEnvio.nombre_archivo, content: pdfBuffer },
      ],
    });
    return { message: `Correo enviado a ${datosEnvio.destinatario}` };
  }

  async cancelarFactura(idFactura: number) {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query('CALL sp_cancelar_factura($1)', [idFactura]);
      await queryRunner.commitTransaction();
      return { message: 'Factura cancelada y stock restaurado en Kardex con éxito' };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }


}
