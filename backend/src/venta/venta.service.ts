// backend/src/venta/venta.service.ts
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateVentaDto } from './venta.dto';
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

  async create(createVentaDto: CreateVentaDto) {
    const conceptosJson = JSON.stringify(createVentaDto.conceptos);
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await queryRunner.query(
        `SELECT fn_crear_venta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) as id_factura`,
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
        ],
      );

      await queryRunner.commitTransaction();

      return {
        message: 'Venta registrada con éxito',
        idFactura: result[0].id_factura,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(page: number = 1, limit: number = 10) {
    const offset = (page - 1) * limit;

    const [totalResult, dataResult] = await Promise.all([
      this.dataSource.query('SELECT COUNT(*) as count FROM fn_get_facturas()'),
      this.dataSource.query(
        'SELECT * FROM fn_get_facturas() LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
    ]);

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
