import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateUnidadClienteDto, UpdateUnidadClienteDto } from './crm.dto';
import { queryRows } from '../common/database/typed-query';
import { IdUnidadRow, UnidadDbRow } from './crm.types';
import { CrmOportunidadesService } from './crm-oportunidades.service';
@Injectable()
export class CrmUnidadesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly oportunidades: CrmOportunidadesService,
  ) {}
  async getUnidades(idOportunidad: number) {
    const oportunidad = (await this.oportunidades.findOne(idOportunidad)) as {
      idCliente?: number | null;
    };
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT id_unidad AS "idUnidad",
      id_cliente AS "idCliente", id_oportunidad AS "idOportunidad", vin, esn,
      numero_economico AS "numeroEconomico", marca, modelo, anio, motor, notas,
      created_at AS "createdAt", updated_at AS "updatedAt"
      FROM crm_unidad_cliente
      WHERE id_oportunidad=$1 OR ($2::int IS NOT NULL AND id_cliente=$2)
      ORDER BY updated_at DESC, id_unidad DESC`,
      [idOportunidad, oportunidad.idCliente ?? null],
    );
  }

  async getUnidadesCliente(idCliente: number) {
    await this.ensureClienteExists(this.dataSource, idCliente);
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT id_unidad AS "idUnidad",
      id_cliente AS "idCliente", id_oportunidad AS "idOportunidad", vin, esn,
      numero_economico AS "numeroEconomico", marca, modelo, anio, motor, notas,
      created_at AS "createdAt", updated_at AS "updatedAt"
      FROM crm_unidad_cliente WHERE id_cliente=$1
      ORDER BY updated_at DESC, id_unidad DESC`,
      [idCliente],
    );
  }

  async addUnidadCliente(idCliente: number, dto: CreateUnidadClienteDto) {
    this.validateUnidad(dto.vin, dto.esn);
    return this.dataSource.transaction(async (manager) => {
      await this.ensureClienteExists(manager, idCliente);
      const result = await queryRows<IdUnidadRow>(
        manager,
        `INSERT INTO crm_unidad_cliente(
        id_cliente,id_oportunidad,vin,esn,numero_economico,marca,modelo,anio,motor,notas)
        VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_unidad AS "idUnidad"`,
        [
          idCliente,
          this.normalizeVin(dto.vin),
          this.normalizeEsn(dto.esn),
          dto.numeroEconomico || null,
          dto.marca || null,
          dto.modelo || null,
          dto.anio ?? null,
          dto.motor || null,
          dto.notas || null,
        ],
      );
      return result[0];
    });
  }

  async addUnidad(
    idOportunidad: number,
    dto: CreateUnidadClienteDto,
    idUser?: number,
  ) {
    this.validateUnidad(dto.vin, dto.esn);
    return this.dataSource.transaction(async (manager) => {
      const oportunidad = await this.oportunidades.lockOportunidad(
        manager,
        idOportunidad,
      );
      const result = await queryRows<IdUnidadRow>(
        manager,
        `INSERT INTO crm_unidad_cliente(
        id_cliente,id_oportunidad,vin,esn,numero_economico,marca,modelo,anio,motor,notas)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id_unidad AS "idUnidad"`,
        [
          oportunidad.id_cliente,
          idOportunidad,
          this.normalizeVin(dto.vin),
          this.normalizeEsn(dto.esn),
          dto.numeroEconomico || null,
          dto.marca || null,
          dto.modelo || null,
          dto.anio ?? null,
          dto.motor || null,
          dto.notas || null,
        ],
      );
      await manager.query(
        `INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
        VALUES ($1,'Nota',$2,$3)`,
        [
          idOportunidad,
          `Unidad registrada${dto.vin ? ` · VIN ${this.normalizeVin(dto.vin)}` : ''}${dto.esn ? ` · ESN ${this.normalizeEsn(dto.esn)}` : ''}`,
          idUser ?? null,
        ],
      );
      return result[0];
    });
  }

  async updateUnidad(id: number, dto: UpdateUnidadClienteDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await queryRows<UnidadDbRow>(
        manager,
        'SELECT * FROM crm_unidad_cliente WHERE id_unidad=$1 FOR UPDATE',
        [id],
      );
      if (!rows.length) throw new NotFoundException('Unidad no encontrada');
      const current = rows[0];
      const vin = dto.vin !== undefined ? dto.vin : current.vin;
      const esn = dto.esn !== undefined ? dto.esn : current.esn;
      this.validateUnidad(vin, esn);
      await manager.query(
        `UPDATE crm_unidad_cliente SET vin=$2,esn=$3,numero_economico=$4,
        marca=$5,modelo=$6,anio=$7,motor=$8,notas=$9,updated_at=now() WHERE id_unidad=$1`,
        [
          id,
          this.normalizeVin(vin),
          this.normalizeEsn(esn),
          dto.numeroEconomico !== undefined
            ? dto.numeroEconomico
            : current.numero_economico,
          dto.marca !== undefined ? dto.marca : current.marca,
          dto.modelo !== undefined ? dto.modelo : current.modelo,
          dto.anio !== undefined ? dto.anio : current.anio,
          dto.motor !== undefined ? dto.motor : current.motor,
          dto.notas !== undefined ? dto.notas : current.notas,
        ],
      );
      if (current.id_oportunidad)
        await manager.query(
          `INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
        VALUES ($1,'Nota',$2,$3)`,
          [
            current.id_oportunidad,
            `Datos de unidad actualizados${vin ? ` · VIN ${this.normalizeVin(vin)}` : ''}`,
            idUser ?? null,
          ],
        );
      return { message: 'Unidad actualizada' };
    });
  }

  async deleteUnidad(id: number, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await queryRows<UnidadDbRow>(
        manager,
        'SELECT * FROM crm_unidad_cliente WHERE id_unidad=$1 FOR UPDATE',
        [id],
      );
      if (!rows.length) throw new NotFoundException('Unidad no encontrada');
      const unit = rows[0];
      const [history]=await queryRows<{present:boolean}>(manager,`SELECT EXISTS(
        SELECT 1 FROM crm_unidad_lectura WHERE id_unidad=$1 UNION ALL
        SELECT 1 FROM crm_unidad_mantenimiento WHERE id_unidad=$1 UNION ALL
        SELECT 1 FROM crm_unidad_archivo WHERE id_unidad=$1 UNION ALL
        SELECT 1 FROM crm_unidad_pieza WHERE id_unidad=$1) AS present`,[id]);
      if(history?.present)throw new ConflictException('La unidad tiene expediente histórico. Conserva la unidad y anula o retira registros con motivo cuando corresponda.');
      await manager.query('DELETE FROM crm_unidad_cliente WHERE id_unidad=$1', [
        id,
      ]);
      if (unit.id_oportunidad)
        await manager.query(
          `INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
        VALUES ($1,'Nota',$2,$3)`,
          [
            unit.id_oportunidad,
            `Unidad eliminada${unit.vin ? ` · VIN ${unit.vin}` : ''}${unit.esn ? ` · ESN ${unit.esn}` : ''}`,
            idUser ?? null,
          ],
        );
      return { message: 'Unidad eliminada' };
    });
  }

  private validateUnidad(vin?: string | null, esn?: string | null) {
    const cleanVin = this.normalizeVin(vin);
    const cleanEsn = this.normalizeEsn(esn);
    if (!cleanVin && !cleanEsn)
      throw new BadRequestException(
        'Captura el VIN del camión o el ESN del motor',
      );
    if (cleanVin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin)) {
      throw new BadRequestException(
        'El VIN debe contener 17 caracteres válidos; no usa I, O ni Q',
      );
    }
    if (cleanEsn && cleanEsn.length < 3)
      throw new BadRequestException(
        'El ESN debe contener al menos 3 caracteres',
      );
  }

  private async ensureClienteExists(
    source: {
      query: (sql: string, parameters?: unknown[]) => Promise<unknown>;
    },
    idCliente: number,
  ) {
    const rows = await queryRows<{ id: number }>(
      source,
      'SELECT "IdCliente" AS id FROM cliente WHERE "IdCliente"=$1',
      [idCliente],
    );
    if (!rows.length) throw new NotFoundException('Cliente no encontrado');
  }

  private normalizeVin(value?: string | null) {
    return value?.replace(/[\s-]/g, '').toUpperCase() || null;
  }

  private normalizeEsn(value?: string | null) {
    return value?.trim().toUpperCase() || null;
  }
}
