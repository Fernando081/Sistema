// backend/src/pago/pago.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RegistrarPagoDto } from './pago.dto';

@Injectable()
export class PagoService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  // Registrar un pago
  async registrarPago(dto: RegistrarPagoDto) {
    try {
      const result = await this.dataSource.query(
        `SELECT fn_registrar_pago($1, $2, $3, $4, $5) as id_pago`,
        [dto.idFactura, dto.monto, dto.formaPago, dto.referencia || '', dto.notas || '']
      );
      return { message: 'Pago registrado con éxito', idPago: result[0].id_pago };
    } catch (error: any) { // Tipado como any para acceder a message
      throw new BadRequestException(error.message || 'Error al registrar pago');
    }
  }

  // Obtener historial de pagos de una factura
  async getPagosPorFactura(idFactura: number) {
    return this.dataSource.query(
      `SELECT * FROM pago WHERE id_factura = $1 ORDER BY fecha_pago DESC`, 
      [idFactura]
    );
  }
  
  // Buscar facturas pendientes de un cliente (Para el selector)
  async getPendientesPorCliente(idCliente: number) {
    return this.dataSource.query(
      `SELECT id_factura, serie, folio, fecha_emision, total, saldo_pendiente 
       FROM factura 
       WHERE id_cliente = $1 AND saldo_pendiente > 0 
       ORDER BY fecha_emision ASC`,
      [idCliente]
    );
  }
}