import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  CreateOportunidadDto,
  CreateSeguimientoDto,
  CreateVentaPerdidaDto,
  CrmPageQuery,
  OportunidadesQuery,
  UpdateOportunidadDto,
  VentasPerdidasQuery,
} from './crm.dto';
import { queryRows } from '../common/database/typed-query';
import {
  OportunidadDbRow,
  TotalRow,
  IdOportunidadRow,
  IdSeguimientoRow,
  IdVentaPerdidaRow,
} from './crm.types';
const OPORTUNIDAD_COLUMNS = `o.id_oportunidad AS "idOportunidad", o.id_cliente AS "idCliente",
  o.empresa, o.contacto, o.telefono, o.email, o.tipo_cliente AS "tipoCliente", o.etapa,
  o.monto_estimado AS "montoEstimado", o.siguiente_accion AS "siguienteAccion",
  o.fecha_siguiente_accion AS "fechaSiguienteAccion", o.motivo_perdida AS "motivoPerdida",
  u.username AS responsable, o.version, o.updated_at AS "updatedAt"`;
const CLOSED = ['Ganada', 'Perdida'];
const LIKE = (value?: string) =>
  `%${(value || '').replace(/[\\%_]/g, '\\$&')}%`;
@Injectable()
export class CrmOportunidadesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  async findAll(query: OportunidadesQuery = new OportunidadesQuery()) {
    const where = `WHERE ($1::text IS NULL OR o.etapa=$1)
      AND (o.empresa ILIKE $2 OR COALESCE(o.contacto,'') ILIKE $2 OR COALESCE(o.telefono,'') ILIKE $2
        OR EXISTS (SELECT 1 FROM crm_unidad_cliente cu WHERE (cu.id_oportunidad=o.id_oportunidad OR cu.id_cliente=o.id_cliente)
          AND (COALESCE(cu.vin,'') ILIKE $2 OR COALESCE(cu.esn,'') ILIKE $2 OR COALESCE(cu.numero_economico,'') ILIKE $2)))
      AND ($3::text IS NULL OR $3='todas' OR (
        o.etapa NOT IN ('Ganada','Perdida') AND (
          ($3='vencidas' AND o.fecha_siguiente_accion < now()) OR
          ($3='hoy' AND (o.fecha_siguiente_accion AT TIME ZONE 'America/Mexico_City')::date =
            (now() AT TIME ZONE 'America/Mexico_City')::date) OR
          ($3='sin-fecha' AND o.fecha_siguiente_accion IS NULL))))`;
    const params = [query.etapa || null, LIKE(query.q), query.agenda || null];
    const [data, count] = await Promise.all([
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT ${OPORTUNIDAD_COLUMNS} FROM crm_oportunidad o
        LEFT JOIN auth_user u ON u.id_user=o.id_responsable ${where}
        ORDER BY (o.etapa IN ('Ganada','Perdida')), o.fecha_siguiente_accion NULLS LAST,
          o.updated_at DESC, o.id_oportunidad DESC LIMIT $4 OFFSET $5`,
        [...params, query.limit, (query.page - 1) * query.limit],
      ),
      queryRows<TotalRow>(
        this.dataSource,
        `SELECT count(*)::int AS total FROM crm_oportunidad o ${where}`,
        params,
      ),
    ]);
    return {
      data,
      total: count[0].total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(id: number) {
    const rows = await queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT ${OPORTUNIDAD_COLUMNS} FROM crm_oportunidad o
      LEFT JOIN auth_user u ON u.id_user=o.id_responsable WHERE o.id_oportunidad=$1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Oportunidad no encontrada');
    return rows[0];
  }

  async resumen() {
    const rows = await queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT
      count(*) FILTER (WHERE etapa NOT IN ('Ganada','Perdida'))::int AS abiertas,
      COALESCE(sum(monto_estimado) FILTER (WHERE etapa NOT IN ('Ganada','Perdida')),0) AS "montoAbierto",
      count(*) FILTER (WHERE etapa NOT IN ('Ganada','Perdida') AND fecha_siguiente_accion < now())::int AS vencidas,
      count(*) FILTER (WHERE etapa='Ganada')::int AS ganadas,
      count(*) FILTER (WHERE etapa='Perdida')::int AS perdidas,
      (SELECT count(*)::int FROM venta_perdida WHERE created_at >= now()-interval '30 days') AS "ventasPerdidas30Dias"
      FROM crm_oportunidad`,
    );
    return rows[0];
  }

  async busquedaGlobal(q: string) {
    const like = LIKE(q.trim());
    const normalized = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedLike = normalized
      ? `%${normalized}%`
      : '__sin_coincidencia_normalizada__';
    const [productos, clientes, unidades] = await Promise.all([
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT DISTINCT p."IdProducto" AS id,
        p."Codigo" AS codigo, p."Descripcion" AS titulo, p."Marca" AS subtitulo,
        p."Existencia" AS existencia, p."PrecioUnitario" AS precio
        FROM producto p
        LEFT JOIN producto_numero_parte np ON np.id_producto=p."IdProducto"
        LEFT JOIN producto_aplicacion pa ON pa.id_producto=p."IdProducto"
        WHERE p."Codigo" ILIKE $1 OR p."Descripcion" ILIKE $1 OR COALESCE(p."Marca",'') ILIKE $1
          OR np.numero_normalizado LIKE $2 OR COALESCE(pa.modelo,'') ILIKE $1 OR COALESCE(pa.motor,'') ILIKE $1
        ORDER BY p."Descripcion" LIMIT 8`,
        [like, normalizedLike],
      ),
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT "IdCliente" AS id, "RazonSocial" AS titulo,
        "RFC" AS codigo, COALESCE(email,'') AS subtitulo FROM cliente
        WHERE "RazonSocial" ILIKE $1 OR "RFC" ILIKE $1 OR COALESCE(email,'') ILIKE $1
        ORDER BY "RazonSocial" LIMIT 5`,
        [like],
      ),
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT u.id_unidad AS id,
        COALESCE(u.numero_economico,u.vin,u.esn) AS titulo,
        concat_ws(' · ',u.marca,u.modelo,u.anio::text,u.motor) AS subtitulo,
        concat_ws(' / ',u.vin,u.esn) AS codigo, COALESCE(c."RazonSocial",o.empresa) AS cliente
        FROM crm_unidad_cliente u LEFT JOIN cliente c ON c."IdCliente"=u.id_cliente
        LEFT JOIN crm_oportunidad o ON o.id_oportunidad=u.id_oportunidad
        WHERE COALESCE(u.vin,'') ILIKE $1 OR COALESCE(u.esn,'') ILIKE $1
          OR COALESCE(u.numero_economico,'') ILIKE $1 OR COALESCE(u.motor,'') ILIKE $1
        ORDER BY u.updated_at DESC LIMIT 5`,
        [like],
      ),
    ]);
    return { productos, clientes, unidades };
  }

  async create(dto: CreateOportunidadDto, idUser?: number) {
    this.validatePlan(
      dto.etapa,
      dto.motivoPerdida,
      dto.siguienteAccion,
      dto.fechaSiguienteAccion,
    );
    const result = await queryRows<IdOportunidadRow>(
      this.dataSource,
      `INSERT INTO crm_oportunidad (
      id_cliente, empresa, contacto, telefono, email, tipo_cliente, etapa,
      monto_estimado, siguiente_accion, fecha_siguiente_accion, motivo_perdida, id_responsable
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id_oportunidad AS "idOportunidad"`,
      [
        dto.idCliente ?? null,
        dto.empresa.trim(),
        dto.contacto || null,
        dto.telefono || null,
        dto.email || null,
        dto.tipoCliente,
        dto.etapa,
        dto.montoEstimado,
        CLOSED.includes(dto.etapa) ? null : dto.siguienteAccion || null,
        CLOSED.includes(dto.etapa) ? null : dto.fechaSiguienteAccion || null,
        dto.etapa === 'Perdida' ? dto.motivoPerdida : null,
        idUser ?? null,
      ],
    );
    return result[0];
  }

  async update(id: number, dto: UpdateOportunidadDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.lockOportunidad(
        manager,
        id,
        dto.expectedVersion,
      );
      const etapa = dto.etapa ?? current.etapa;
      const motivo =
        dto.motivoPerdida !== undefined
          ? dto.motivoPerdida
          : current.motivo_perdida;
      const accion =
        dto.siguienteAccion !== undefined
          ? dto.siguienteAccion
          : current.siguiente_accion;
      const fecha =
        dto.fechaSiguienteAccion !== undefined
          ? dto.fechaSiguienteAccion
          : current.fecha_siguiente_accion;
      this.validatePlan(etapa, motivo, accion, fecha);
      await manager.query(
        `UPDATE crm_oportunidad SET id_cliente=$2,empresa=$3,contacto=$4,
        telefono=$5,email=$6,tipo_cliente=$7,etapa=$8,monto_estimado=$9,siguiente_accion=$10,
        fecha_siguiente_accion=$11,motivo_perdida=$12,updated_at=now(),version=version+1
        WHERE id_oportunidad=$1`,
        [
          id,
          dto.idCliente !== undefined ? dto.idCliente : current.id_cliente,
          dto.empresa?.trim() ?? current.empresa,
          dto.contacto !== undefined ? dto.contacto : current.contacto,
          dto.telefono !== undefined ? dto.telefono : current.telefono,
          dto.email !== undefined ? dto.email : current.email,
          dto.tipoCliente !== undefined
            ? dto.tipoCliente
            : current.tipo_cliente,
          etapa,
          dto.montoEstimado !== undefined
            ? dto.montoEstimado
            : current.monto_estimado,
          CLOSED.includes(etapa) ? null : accion || null,
          CLOSED.includes(etapa) ? null : fecha || null,
          etapa === 'Perdida' ? motivo : null,
        ],
      );
      if (current.etapa !== etapa) {
        await manager.query(
          `INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
          VALUES ($1,'Nota',$2,$3)`,
          [
            id,
            `Etapa: ${current.etapa} → ${etapa}${etapa === 'Perdida' ? `. Motivo: ${motivo}` : ''}`,
            idUser ?? null,
          ],
        );
      }
      return {
        message: 'Oportunidad actualizada',
        version: current.version + 1,
      };
    });
  }

  async addSeguimiento(id: number, dto: CreateSeguimientoDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.lockOportunidad(
        manager,
        id,
        dto.expectedVersion,
      );
      const newPlan =
        dto.siguienteAccion !== undefined ||
        dto.fechaSiguienteAccion !== undefined;
      if (
        newPlan &&
        CLOSED.includes(current.etapa) &&
        (dto.siguienteAccion || dto.fechaSiguienteAccion)
      ) {
        throw new BadRequestException(
          'Reabre la oportunidad antes de programar otra acción',
        );
      }
      const accion = newPlan
        ? dto.siguienteAccion
        : dto.completarAccion
          ? null
          : current.siguiente_accion;
      const fecha = newPlan
        ? dto.fechaSiguienteAccion
        : dto.completarAccion
          ? null
          : current.fecha_siguiente_accion;
      this.validatePlan(current.etapa, current.motivo_perdida, accion, fecha);
      const completed =
        dto.completarAccion && current.siguiente_accion
          ? `\nAcción completada: ${current.siguiente_accion}`
          : '';
      const result = await queryRows<IdSeguimientoRow>(
        manager,
        `INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
        VALUES ($1,$2,$3,$4) RETURNING id_seguimiento AS "idSeguimiento"`,
        [id, dto.tipo, dto.detalle.trim() + completed, idUser ?? null],
      );
      await manager.query(
        `UPDATE crm_oportunidad SET updated_at=now(),version=version+1,
        siguiente_accion=$2,fecha_siguiente_accion=$3 WHERE id_oportunidad=$1`,
        [id, accion || null, fecha || null],
      );
      return result[0];
    });
  }

  async getSeguimientos(id: number, query: CrmPageQuery = new CrmPageQuery()) {
    await this.findOne(id);
    const [data, count] = await Promise.all([
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT s.id_seguimiento AS "idSeguimiento",s.tipo,s.detalle,
        s.created_at AS "createdAt",u.username FROM crm_seguimiento s
        LEFT JOIN auth_user u ON u.id_user=s.id_user WHERE s.id_oportunidad=$1
        ORDER BY s.created_at DESC,s.id_seguimiento DESC LIMIT $2 OFFSET $3`,
        [id, query.limit, (query.page - 1) * query.limit],
      ),
      queryRows<TotalRow>(
        this.dataSource,
        'SELECT count(*)::int AS total FROM crm_seguimiento WHERE id_oportunidad=$1',
        [id],
      ),
    ]);
    return {
      data,
      total: count[0].total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getVentasPerdidas(
    query: VentasPerdidasQuery = new VentasPerdidasQuery(),
  ) {
    const where = `WHERE ($1::text IS NULL OR v.motivo=$1) AND v.descripcion_buscada ILIKE $2`;
    const params = [query.motivo || null, LIKE(query.q)];
    const [data, count] = await Promise.all([
      queryRows<Record<string, unknown>>(
        this.dataSource,
        `SELECT v.id_venta_perdida AS "idVentaPerdida",
        v.descripcion_buscada AS "descripcionBuscada",v.cantidad,v.motivo,v.notas,
        v.created_at AS "createdAt",o.empresa,u.username AS responsable,
        p."Codigo" AS "codigoProducto" FROM venta_perdida v
        LEFT JOIN crm_oportunidad o ON o.id_oportunidad=v.id_oportunidad
        LEFT JOIN auth_user u ON u.id_user=v.id_user
        LEFT JOIN producto p ON p."IdProducto"=v.id_producto ${where}
        ORDER BY v.created_at DESC,v.id_venta_perdida DESC LIMIT $3 OFFSET $4`,
        [...params, query.limit, (query.page - 1) * query.limit],
      ),
      queryRows<TotalRow>(
        this.dataSource,
        `SELECT count(*)::int AS total FROM venta_perdida v ${where}`,
        params,
      ),
    ]);
    return {
      data,
      total: count[0].total,
      page: query.page,
      limit: query.limit,
    };
  }

  async registrarVentaPerdida(dto: CreateVentaPerdidaDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      let idCliente = dto.idCliente ?? null;
      if (dto.idOportunidad) {
        const oportunidad = await this.lockOportunidad(
          manager,
          dto.idOportunidad,
        );
        if (
          idCliente &&
          oportunidad.id_cliente &&
          idCliente !== oportunidad.id_cliente
        ) {
          throw new BadRequestException(
            'El cliente no corresponde a la oportunidad',
          );
        }
        idCliente ??= oportunidad.id_cliente;
      }
      const result = await queryRows<IdVentaPerdidaRow>(
        manager,
        `INSERT INTO venta_perdida(
        id_oportunidad,id_cliente,id_producto,descripcion_buscada,cantidad,motivo,notas,id_user)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_venta_perdida AS "idVentaPerdida"`,
        [
          dto.idOportunidad ?? null,
          idCliente,
          dto.idProducto ?? null,
          dto.descripcionBuscada.trim(),
          dto.cantidad,
          dto.motivo,
          dto.notas || null,
          idUser ?? null,
        ],
      );
      return result[0];
    });
  }

  async lockOportunidad(
    manager: EntityManager,
    id: number,
    expectedVersion?: number,
  ): Promise<OportunidadDbRow> {
    const rows = await queryRows<OportunidadDbRow>(
      manager,
      'SELECT * FROM crm_oportunidad WHERE id_oportunidad=$1 FOR UPDATE',
      [id],
    );
    if (!rows.length) throw new NotFoundException('Oportunidad no encontrada');
    if (expectedVersion !== undefined && rows[0].version !== expectedVersion) {
      throw new ConflictException(
        'La oportunidad cambió. Recárgala antes de guardar para conservar los cambios de otros usuarios',
      );
    }
    return rows[0];
  }

  private validatePlan(
    etapa: string,
    motivo?: string | null,
    accion?: string | null,
    fecha?: string | null,
  ) {
    if (etapa === 'Perdida' && !motivo?.trim()) {
      throw new BadRequestException(
        'Indica el motivo cuando una oportunidad se pierde',
      );
    }
    if (!CLOSED.includes(etapa) && fecha && !accion?.trim()) {
      throw new BadRequestException(
        'Describe la siguiente acción para programar una fecha',
      );
    }
  }
}
