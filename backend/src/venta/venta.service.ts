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

  async create(createVentaDto: CreateVentaDto, idVendedor?: number) {
    const conceptosJson = JSON.stringify(createVentaDto.conceptos);
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await queryRunner.query(
        `SELECT fn_crear_venta($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) as id_factura`,
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

  async getComisionesSemanales() {
    return this.dataSource.query('SELECT * FROM fn_get_comisiones_semanales()');
  }

  async findAll(page: number = 1, limit: number = 10, term: string = '') {
    const offset = (page - 1) * limit;

    console.log(`[VentaService] findAll args: page=${page}, limit=${limit}, term='${term}'`);

    const [totalResult, dataResult] = await Promise.all([
      this.dataSource.query('SELECT COUNT(*) as count FROM fn_get_facturas(NULL, NULL, $1)', [term]),
      this.dataSource.query(
        'SELECT * FROM fn_get_facturas($1, $2, $3)',
        [limit, offset, term]
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

  async devolverParcial(idFactura: number, dto: ProcesarDevolucionDto, idUser?: number) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const articulosJson = JSON.stringify(dto.articulos);
      
      const typeOrmParams = [idFactura, dto.metodoReembolso, articulosJson, idUser || null];
      require('fs').writeFileSync('c:\\Sistema\\backend\\_debug_typeorm.txt', JSON.stringify(typeOrmParams));

      // 1. Database execution (Kardex, Saldos)
      const result = await queryRunner.query(
        `SELECT sp_procesar_devolucion_parcial($1::int, $2::varchar, $3::jsonb, $4::int) as id_devolucion`,
        typeOrmParams
      );
      const idDevolucion = result[0].id_devolucion;

      // 2. CFDI 4.0 Egreso Payload Modeling
      const fact = await queryRunner.query('SELECT folio, uuid FROM factura WHERE id_factura = $1', [idFactura]);
      const totalDevolucion = dto.articulos.reduce((acc, item) => acc + (item.cantidad * item.precioUnitario), 0);

      const cfdiMock = {
        Version: "4.0",
        TipoDeComprobante: "E", // Egreso / Nota de Crédito
        Total: totalDevolucion.toFixed(2),
        Moneda: "MXN",
        Exportacion: "01",
        CfdiRelacionados: {
          TipoRelacion: "01", // Nota de crédito de los documentos relacionados
          CfdiRelacionado: [{ UUID: fact[0]?.uuid || "00000000-0000-0000-0000-000000000000" }]
        },
        Conceptos: dto.articulos.map(a => ({
          ClaveProdServ: "84111506",
          Cantidad: a.cantidad,
          ClaveUnidad: "ACT",
          Descripcion: "Devolución de Mercancía ref: " + fact[0]?.folio,
          ValorUnitario: a.precioUnitario.toFixed(2),
          Importe: (a.cantidad * a.precioUnitario).toFixed(2),
          ObjetoImp: "02"
        }))
      };

      await queryRunner.commitTransaction();

      return {
        message: 'Devolución parcial aplicada con éxito',
        idDevolucion,
        cfdiEgresoBase: cfdiMock
      };
    } catch (error) {
      require('fs').writeFileSync('c:\\Sistema\\backend\\_debug_sp.txt', String(error?.message) + '\n' + String(error?.stack));
      console.error('------- SP EXCEPTION -------', error.message, error.stack);
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
