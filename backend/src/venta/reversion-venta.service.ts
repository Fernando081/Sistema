import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ProcesarDevolucionDto } from './venta.dto';
import { queryRows } from '../common/database/typed-query';
import { FiscalService } from '../fiscal/fiscal.service';
import { CancelFiscalDocumentDto } from '../fiscal/fiscal.dto';
import { DevolucionIdRow } from './venta.types';
@Injectable()
export class ReversionVentaService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fiscalService?: FiscalService,
  ) {}
  async cancelarFactura(
    idFactura: number,
    idUsuario?: number,
    fiscalDto: CancelFiscalDocumentDto = {},
  ) {
    const fiscalResult = this.fiscalService
      ? await this.fiscalService.cancel(
          'FACTURA',
          idFactura,
          fiscalDto,
          idUsuario,
        )
      : { fiscal: false, cancelled: true, state: 'Sin timbrar' };
    if (!fiscalResult.cancelled) {
      return {
        message:
          'La solicitud fue recibida por el PAC. La operación se revertirá cuando SAT confirme la cancelación.',
        ...fiscalResult,
      };
    }
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Mantiene el mismo orden de bloqueo que el alta de notas de crédito.
      await queryRunner.query(
        `SELECT f.id_factura FROM factura f
        WHERE f.id_factura=(SELECT id_factura_origen FROM factura WHERE id_factura=$1) FOR UPDATE`,
        [idFactura],
      );
      await queryRunner.query('CALL sp_cancelar_factura($1, $2)', [
        idFactura,
        idUsuario ?? null,
      ]);
      await queryRunner.commitTransaction();
      return {
        message: 'Factura cancelada y stock restaurado en Kardex con éxito',
        ...fiscalResult,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async procesarDevolucion(
    idFactura: number,
    dto: ProcesarDevolucionDto,
    idUsuario?: number,
  ) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await queryRows<DevolucionIdRow>(
        queryRunner,
        'SELECT sp_procesar_devolucion_parcial($1, $2, $3::jsonb, $4) AS id_devolucion',
        [
          idFactura,
          dto.metodoReembolso,
          JSON.stringify(dto.articulos),
          idUsuario ?? null,
        ],
      );
      await queryRunner.commitTransaction();
      return {
        idDevolucion: Number(result[0].id_devolucion),
        message: 'Devolución registrada e inventario actualizado',
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
