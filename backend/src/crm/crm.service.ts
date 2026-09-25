import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  CreateCampanaDto, CreateCrmComunicacionDto, CreateCrmTareaDto, CreateEncuestaDto, CreateMetaDto, CreateOportunidadDto, CreatePlantillaDto, CreateSegmentoDto, CreateSeguimientoDto, CreateUnidadClienteDto, CreateVentaPerdidaDto,
  CrmPageQuery, CrmTareasQuery, OportunidadesQuery, UpdateCrmTareaDto, UpdateOportunidadDto, UpdateUnidadClienteDto, VentasPerdidasQuery,
} from './crm.dto';
import { queryRows } from '../common/database/typed-query';
import { RolUsuario } from '../common/enums/app.enums';

interface OportunidadDbRow {
  id_oportunidad: number;
  id_cliente: number | null;
  empresa: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  tipo_cliente: string;
  etapa: string;
  monto_estimado: string | number;
  siguiente_accion: string | null;
  fecha_siguiente_accion: string | null;
  motivo_perdida: string | null;
  version: number;
}

interface TotalRow { total: number; }
export interface IdOportunidadRow { idOportunidad: number; }
export interface IdSeguimientoRow { idSeguimiento: number; }
export interface IdVentaPerdidaRow { idVentaPerdida: number; }
export interface IdUnidadRow { idUnidad: number; }

interface UnidadDbRow {
  id_unidad: number;
  id_cliente: number | null;
  id_oportunidad: number | null;
  vin: string | null;
  esn: string | null;
  numero_economico: string | null;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  motor: string | null;
  notas: string | null;
}

const OPORTUNIDAD_COLUMNS = `o.id_oportunidad AS "idOportunidad", o.id_cliente AS "idCliente",
  o.empresa, o.contacto, o.telefono, o.email, o.tipo_cliente AS "tipoCliente", o.etapa,
  o.monto_estimado AS "montoEstimado", o.siguiente_accion AS "siguienteAccion",
  o.fecha_siguiente_accion AS "fechaSiguienteAccion", o.motivo_perdida AS "motivoPerdida",
  u.username AS responsable, o.version, o.updated_at AS "updatedAt"`;
const CLOSED = ['Ganada', 'Perdida'];
const LIKE = (value?: string) => `%${(value || '').replace(/[\\%_]/g, '\\$&')}%`;

@Injectable()
export class CrmService {
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
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT ${OPORTUNIDAD_COLUMNS} FROM crm_oportunidad o
        LEFT JOIN auth_user u ON u.id_user=o.id_responsable ${where}
        ORDER BY (o.etapa IN ('Ganada','Perdida')), o.fecha_siguiente_accion NULLS LAST,
          o.updated_at DESC, o.id_oportunidad DESC LIMIT $4 OFFSET $5`,
      [...params, query.limit, (query.page - 1) * query.limit]),
      queryRows<TotalRow>(this.dataSource, `SELECT count(*)::int AS total FROM crm_oportunidad o ${where}`, params),
    ]);
    return { data, total: count[0].total, page: query.page, limit: query.limit };
  }

  async findOne(id: number) {
    const rows = await queryRows<Record<string, unknown>>(this.dataSource, `SELECT ${OPORTUNIDAD_COLUMNS} FROM crm_oportunidad o
      LEFT JOIN auth_user u ON u.id_user=o.id_responsable WHERE o.id_oportunidad=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Oportunidad no encontrada');
    return rows[0];
  }

  async resumen() {
    const rows = await queryRows<Record<string, unknown>>(this.dataSource, `SELECT
      count(*) FILTER (WHERE etapa NOT IN ('Ganada','Perdida'))::int AS abiertas,
      COALESCE(sum(monto_estimado) FILTER (WHERE etapa NOT IN ('Ganada','Perdida')),0) AS "montoAbierto",
      count(*) FILTER (WHERE etapa NOT IN ('Ganada','Perdida') AND fecha_siguiente_accion < now())::int AS vencidas,
      count(*) FILTER (WHERE etapa='Ganada')::int AS ganadas,
      count(*) FILTER (WHERE etapa='Perdida')::int AS perdidas,
      (SELECT count(*)::int FROM venta_perdida WHERE created_at >= now()-interval '30 days') AS "ventasPerdidas30Dias"
      FROM crm_oportunidad`);
    return rows[0];
  }

  async busquedaGlobal(q: string) {
    const like = LIKE(q.trim());
    const normalized = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normalizedLike = normalized ? `%${normalized}%` : '__sin_coincidencia_normalizada__';
    const [productos, clientes, unidades] = await Promise.all([
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT DISTINCT p."IdProducto" AS id,
        p."Codigo" AS codigo, p."Descripcion" AS titulo, p."Marca" AS subtitulo,
        p."Existencia" AS existencia, p."PrecioUnitario" AS precio
        FROM producto p
        LEFT JOIN producto_numero_parte np ON np.id_producto=p."IdProducto"
        LEFT JOIN producto_aplicacion pa ON pa.id_producto=p."IdProducto"
        WHERE p."Codigo" ILIKE $1 OR p."Descripcion" ILIKE $1 OR COALESCE(p."Marca",'') ILIKE $1
          OR np.numero_normalizado LIKE $2 OR COALESCE(pa.modelo,'') ILIKE $1 OR COALESCE(pa.motor,'') ILIKE $1
        ORDER BY p."Descripcion" LIMIT 8`, [like, normalizedLike]),
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT "IdCliente" AS id, "RazonSocial" AS titulo,
        "RFC" AS codigo, COALESCE(email,'') AS subtitulo FROM cliente
        WHERE "RazonSocial" ILIKE $1 OR "RFC" ILIKE $1 OR COALESCE(email,'') ILIKE $1
        ORDER BY "RazonSocial" LIMIT 5`, [like]),
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT u.id_unidad AS id,
        COALESCE(u.numero_economico,u.vin,u.esn) AS titulo,
        concat_ws(' · ',u.marca,u.modelo,u.anio::text,u.motor) AS subtitulo,
        concat_ws(' / ',u.vin,u.esn) AS codigo, COALESCE(c."RazonSocial",o.empresa) AS cliente
        FROM crm_unidad_cliente u LEFT JOIN cliente c ON c."IdCliente"=u.id_cliente
        LEFT JOIN crm_oportunidad o ON o.id_oportunidad=u.id_oportunidad
        WHERE COALESCE(u.vin,'') ILIKE $1 OR COALESCE(u.esn,'') ILIKE $1
          OR COALESCE(u.numero_economico,'') ILIKE $1 OR COALESCE(u.motor,'') ILIKE $1
        ORDER BY u.updated_at DESC LIMIT 5`, [like]),
    ]);
    return { productos, clientes, unidades };
  }

  async create(dto: CreateOportunidadDto, idUser?: number) {
    this.validatePlan(dto.etapa, dto.motivoPerdida, dto.siguienteAccion, dto.fechaSiguienteAccion);
    const result = await queryRows<IdOportunidadRow>(this.dataSource, `INSERT INTO crm_oportunidad (
      id_cliente, empresa, contacto, telefono, email, tipo_cliente, etapa,
      monto_estimado, siguiente_accion, fecha_siguiente_accion, motivo_perdida, id_responsable
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id_oportunidad AS "idOportunidad"`,
    [dto.idCliente ?? null, dto.empresa.trim(), dto.contacto || null, dto.telefono || null,
      dto.email || null, dto.tipoCliente, dto.etapa, dto.montoEstimado,
      CLOSED.includes(dto.etapa) ? null : dto.siguienteAccion || null,
      CLOSED.includes(dto.etapa) ? null : dto.fechaSiguienteAccion || null,
      dto.etapa === 'Perdida' ? dto.motivoPerdida : null, idUser ?? null]);
    return result[0];
  }

  async update(id: number, dto: UpdateOportunidadDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.lockOportunidad(manager, id, dto.expectedVersion);
      const etapa = dto.etapa ?? current.etapa;
      const motivo = dto.motivoPerdida !== undefined ? dto.motivoPerdida : current.motivo_perdida;
      const accion = dto.siguienteAccion !== undefined ? dto.siguienteAccion : current.siguiente_accion;
      const fecha = dto.fechaSiguienteAccion !== undefined ? dto.fechaSiguienteAccion : current.fecha_siguiente_accion;
      this.validatePlan(etapa, motivo, accion, fecha);
      await manager.query(`UPDATE crm_oportunidad SET id_cliente=$2,empresa=$3,contacto=$4,
        telefono=$5,email=$6,tipo_cliente=$7,etapa=$8,monto_estimado=$9,siguiente_accion=$10,
        fecha_siguiente_accion=$11,motivo_perdida=$12,updated_at=now(),version=version+1
        WHERE id_oportunidad=$1`, [id, dto.idCliente !== undefined ? dto.idCliente : current.id_cliente,
        dto.empresa?.trim() ?? current.empresa,
        dto.contacto !== undefined ? dto.contacto : current.contacto,
        dto.telefono !== undefined ? dto.telefono : current.telefono,
        dto.email !== undefined ? dto.email : current.email,
        dto.tipoCliente !== undefined ? dto.tipoCliente : current.tipo_cliente,
        etapa, dto.montoEstimado !== undefined ? dto.montoEstimado : current.monto_estimado,
        CLOSED.includes(etapa) ? null : accion || null,
        CLOSED.includes(etapa) ? null : fecha || null, etapa === 'Perdida' ? motivo : null]);
      if (current.etapa !== etapa) {
        await manager.query(`INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
          VALUES ($1,'Nota',$2,$3)`, [id, `Etapa: ${current.etapa} → ${etapa}${etapa === 'Perdida' ? `. Motivo: ${motivo}` : ''}`, idUser ?? null]);
      }
      return { message: 'Oportunidad actualizada', version: current.version + 1 };
    });
  }

  async addSeguimiento(id: number, dto: CreateSeguimientoDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.lockOportunidad(manager, id, dto.expectedVersion);
      const newPlan = dto.siguienteAccion !== undefined || dto.fechaSiguienteAccion !== undefined;
      if (newPlan && CLOSED.includes(current.etapa) && (dto.siguienteAccion || dto.fechaSiguienteAccion)) {
        throw new BadRequestException('Reabre la oportunidad antes de programar otra acción');
      }
      const accion = newPlan ? dto.siguienteAccion : dto.completarAccion ? null : current.siguiente_accion;
      const fecha = newPlan ? dto.fechaSiguienteAccion : dto.completarAccion ? null : current.fecha_siguiente_accion;
      this.validatePlan(current.etapa, current.motivo_perdida, accion, fecha);
      const completed = dto.completarAccion && current.siguiente_accion
        ? `\nAcción completada: ${current.siguiente_accion}` : '';
      const result = await queryRows<IdSeguimientoRow>(manager, `INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
        VALUES ($1,$2,$3,$4) RETURNING id_seguimiento AS "idSeguimiento"`,
      [id, dto.tipo, dto.detalle.trim() + completed, idUser ?? null]);
      await manager.query(`UPDATE crm_oportunidad SET updated_at=now(),version=version+1,
        siguiente_accion=$2,fecha_siguiente_accion=$3 WHERE id_oportunidad=$1`, [id, accion || null, fecha || null]);
      return result[0];
    });
  }

  async getSeguimientos(id: number, query: CrmPageQuery = new CrmPageQuery()) {
    await this.findOne(id);
    const [data, count] = await Promise.all([
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT s.id_seguimiento AS "idSeguimiento",s.tipo,s.detalle,
        s.created_at AS "createdAt",u.username FROM crm_seguimiento s
        LEFT JOIN auth_user u ON u.id_user=s.id_user WHERE s.id_oportunidad=$1
        ORDER BY s.created_at DESC,s.id_seguimiento DESC LIMIT $2 OFFSET $3`, [id, query.limit, (query.page - 1) * query.limit]),
      queryRows<TotalRow>(this.dataSource, 'SELECT count(*)::int AS total FROM crm_seguimiento WHERE id_oportunidad=$1', [id]),
    ]);
    return { data, total: count[0].total, page: query.page, limit: query.limit };
  }

  async getVentasPerdidas(query: VentasPerdidasQuery = new VentasPerdidasQuery()) {
    const where = `WHERE ($1::text IS NULL OR v.motivo=$1) AND v.descripcion_buscada ILIKE $2`;
    const params = [query.motivo || null, LIKE(query.q)];
    const [data, count] = await Promise.all([
      queryRows<Record<string, unknown>>(this.dataSource, `SELECT v.id_venta_perdida AS "idVentaPerdida",
        v.descripcion_buscada AS "descripcionBuscada",v.cantidad,v.motivo,v.notas,
        v.created_at AS "createdAt",o.empresa,u.username AS responsable,
        p."Codigo" AS "codigoProducto" FROM venta_perdida v
        LEFT JOIN crm_oportunidad o ON o.id_oportunidad=v.id_oportunidad
        LEFT JOIN auth_user u ON u.id_user=v.id_user
        LEFT JOIN producto p ON p."IdProducto"=v.id_producto ${where}
        ORDER BY v.created_at DESC,v.id_venta_perdida DESC LIMIT $3 OFFSET $4`,
      [...params, query.limit, (query.page - 1) * query.limit]),
      queryRows<TotalRow>(this.dataSource, `SELECT count(*)::int AS total FROM venta_perdida v ${where}`, params),
    ]);
    return { data, total: count[0].total, page: query.page, limit: query.limit };
  }

  async registrarVentaPerdida(dto: CreateVentaPerdidaDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      let idCliente = dto.idCliente ?? null;
      if (dto.idOportunidad) {
        const oportunidad = await this.lockOportunidad(manager, dto.idOportunidad);
        if (idCliente && oportunidad.id_cliente && idCliente !== oportunidad.id_cliente) {
          throw new BadRequestException('El cliente no corresponde a la oportunidad');
        }
        idCliente ??= oportunidad.id_cliente;
      }
      const result = await queryRows<IdVentaPerdidaRow>(manager, `INSERT INTO venta_perdida(
        id_oportunidad,id_cliente,id_producto,descripcion_buscada,cantidad,motivo,notas,id_user)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_venta_perdida AS "idVentaPerdida"`,
      [dto.idOportunidad ?? null, idCliente, dto.idProducto ?? null,
        dto.descripcionBuscada.trim(), dto.cantidad, dto.motivo, dto.notas || null, idUser ?? null]);
      return result[0];
    });
  }

  async getUnidades(idOportunidad: number) {
    const oportunidad = await this.findOne(idOportunidad) as { idCliente?: number | null };
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT id_unidad AS "idUnidad",
      id_cliente AS "idCliente", id_oportunidad AS "idOportunidad", vin, esn,
      numero_economico AS "numeroEconomico", marca, modelo, anio, motor, notas,
      created_at AS "createdAt", updated_at AS "updatedAt"
      FROM crm_unidad_cliente
      WHERE id_oportunidad=$1 OR ($2::int IS NOT NULL AND id_cliente=$2)
      ORDER BY updated_at DESC, id_unidad DESC`, [idOportunidad, oportunidad.idCliente ?? null]);
  }

  async getUnidadesCliente(idCliente: number) {
    await this.ensureClienteExists(this.dataSource, idCliente);
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT id_unidad AS "idUnidad",
      id_cliente AS "idCliente", id_oportunidad AS "idOportunidad", vin, esn,
      numero_economico AS "numeroEconomico", marca, modelo, anio, motor, notas,
      created_at AS "createdAt", updated_at AS "updatedAt"
      FROM crm_unidad_cliente WHERE id_cliente=$1
      ORDER BY updated_at DESC, id_unidad DESC`, [idCliente]);
  }

  async addUnidadCliente(idCliente: number, dto: CreateUnidadClienteDto) {
    this.validateUnidad(dto.vin, dto.esn);
    return this.dataSource.transaction(async (manager) => {
      await this.ensureClienteExists(manager, idCliente);
      const result = await queryRows<IdUnidadRow>(manager, `INSERT INTO crm_unidad_cliente(
        id_cliente,id_oportunidad,vin,esn,numero_economico,marca,modelo,anio,motor,notas)
        VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_unidad AS "idUnidad"`, [
        idCliente, this.normalizeVin(dto.vin), this.normalizeEsn(dto.esn), dto.numeroEconomico || null,
        dto.marca || null, dto.modelo || null, dto.anio ?? null, dto.motor || null, dto.notas || null,
      ]);
      return result[0];
    });
  }

  async addUnidad(idOportunidad: number, dto: CreateUnidadClienteDto, idUser?: number) {
    this.validateUnidad(dto.vin, dto.esn);
    return this.dataSource.transaction(async (manager) => {
      const oportunidad = await this.lockOportunidad(manager, idOportunidad);
      const result = await queryRows<IdUnidadRow>(manager, `INSERT INTO crm_unidad_cliente(
        id_cliente,id_oportunidad,vin,esn,numero_economico,marca,modelo,anio,motor,notas)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id_unidad AS "idUnidad"`, [
        oportunidad.id_cliente, idOportunidad, this.normalizeVin(dto.vin), this.normalizeEsn(dto.esn),
        dto.numeroEconomico || null, dto.marca || null, dto.modelo || null, dto.anio ?? null,
        dto.motor || null, dto.notas || null,
      ]);
      await manager.query(`INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
        VALUES ($1,'Nota',$2,$3)`, [idOportunidad,
        `Unidad registrada${dto.vin ? ` · VIN ${this.normalizeVin(dto.vin)}` : ''}${dto.esn ? ` · ESN ${this.normalizeEsn(dto.esn)}` : ''}`,
        idUser ?? null]);
      return result[0];
    });
  }

  async updateUnidad(id: number, dto: UpdateUnidadClienteDto, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await queryRows<UnidadDbRow>(manager,
        'SELECT * FROM crm_unidad_cliente WHERE id_unidad=$1 FOR UPDATE', [id]);
      if (!rows.length) throw new NotFoundException('Unidad no encontrada');
      const current = rows[0];
      const vin = dto.vin !== undefined ? dto.vin : current.vin;
      const esn = dto.esn !== undefined ? dto.esn : current.esn;
      this.validateUnidad(vin, esn);
      await manager.query(`UPDATE crm_unidad_cliente SET vin=$2,esn=$3,numero_economico=$4,
        marca=$5,modelo=$6,anio=$7,motor=$8,notas=$9,updated_at=now() WHERE id_unidad=$1`, [
        id, this.normalizeVin(vin), this.normalizeEsn(esn),
        dto.numeroEconomico !== undefined ? dto.numeroEconomico : current.numero_economico,
        dto.marca !== undefined ? dto.marca : current.marca,
        dto.modelo !== undefined ? dto.modelo : current.modelo,
        dto.anio !== undefined ? dto.anio : current.anio,
        dto.motor !== undefined ? dto.motor : current.motor,
        dto.notas !== undefined ? dto.notas : current.notas,
      ]);
      if (current.id_oportunidad) await manager.query(`INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
        VALUES ($1,'Nota',$2,$3)`, [current.id_oportunidad, `Datos de unidad actualizados${vin ? ` · VIN ${this.normalizeVin(vin)}` : ''}`, idUser ?? null]);
      return { message: 'Unidad actualizada' };
    });
  }

  async deleteUnidad(id: number, idUser?: number) {
    return this.dataSource.transaction(async (manager) => {
      const rows = await queryRows<UnidadDbRow>(manager,
        'SELECT * FROM crm_unidad_cliente WHERE id_unidad=$1 FOR UPDATE', [id]);
      if (!rows.length) throw new NotFoundException('Unidad no encontrada');
      const unit = rows[0];
      await manager.query('DELETE FROM crm_unidad_cliente WHERE id_unidad=$1', [id]);
      if (unit.id_oportunidad) await manager.query(`INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
        VALUES ($1,'Nota',$2,$3)`, [unit.id_oportunidad,
        `Unidad eliminada${unit.vin ? ` · VIN ${unit.vin}` : ''}${unit.esn ? ` · ESN ${unit.esn}` : ''}`, idUser ?? null]);
      return { message: 'Unidad eliminada' };
    });
  }

  segmentos() { return queryRows<Record<string, unknown>>(this.dataSource, `SELECT s.id_segmento AS "idSegmento",s.nombre,s.descripcion,s.tipo_cliente AS "tipoCliente",s.dias_inactivo AS "diasInactivo",s.activo,s.created_at AS "createdAt",(SELECT count(*)::int FROM cliente c WHERE (s.tipo_cliente IS NULL OR EXISTS(SELECT 1 FROM crm_oportunidad o WHERE o.id_cliente=c."IdCliente" AND o.tipo_cliente=s.tipo_cliente)) AND (s.dias_inactivo IS NULL OR NOT EXISTS(SELECT 1 FROM factura f WHERE f.id_cliente=c."IdCliente" AND f.fecha_emision>=current_date-s.dias_inactivo))) AS clientes FROM crm_segmento s ORDER BY s.nombre`); }
  async createSegmento(dto: CreateSegmentoDto, idUser?: number) { const rows = await queryRows<{ idSegmento: number }>(this.dataSource, 'INSERT INTO crm_segmento(nombre,descripcion,tipo_cliente,dias_inactivo,id_user)VALUES($1,$2,$3,$4,$5)RETURNING id_segmento AS "idSegmento"', [dto.nombre, dto.descripcion || null, dto.tipoCliente || null, dto.diasInactivo ?? null, idUser ?? null]); return rows[0]; }
  plantillas() { return queryRows<Record<string, unknown>>(this.dataSource, `SELECT id_plantilla AS "idPlantilla",nombre,canal,asunto,contenido,activa,created_at AS "createdAt" FROM crm_plantilla ORDER BY activa DESC,nombre`); }
  async createPlantilla(dto: CreatePlantillaDto, idUser?: number) { const rows = await queryRows<{ idPlantilla: number }>(this.dataSource, 'INSERT INTO crm_plantilla(nombre,canal,asunto,contenido,id_user)VALUES($1,$2,$3,$4,$5)RETURNING id_plantilla AS "idPlantilla"', [dto.nombre, dto.canal, dto.asunto || null, dto.contenido, idUser ?? null]); return rows[0]; }
  campanas() { return queryRows<Record<string, unknown>>(this.dataSource, `SELECT c.id_campana AS "idCampana",c.nombre,c.estado,c.fecha_inicio AS "fechaInicio",c.fecha_fin AS "fechaFin",c.objetivo,s.nombre AS segmento,p.nombre AS plantilla,p.canal FROM crm_campana c LEFT JOIN crm_segmento s ON s.id_segmento=c.id_segmento LEFT JOIN crm_plantilla p ON p.id_plantilla=c.id_plantilla ORDER BY c.created_at DESC`); }
  async createCampana(dto: CreateCampanaDto, idUser?: number) { const rows = await queryRows<{ idCampana: number }>(this.dataSource, 'INSERT INTO crm_campana(nombre,id_segmento,id_plantilla,fecha_inicio,fecha_fin,objetivo,id_user)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING id_campana AS "idCampana"', [dto.nombre, dto.idSegmento || null, dto.idPlantilla || null, dto.fechaInicio || null, dto.fechaFin || null, dto.objetivo || null, idUser ?? null]); return rows[0]; }
  encuestas() { return queryRows<Record<string, unknown>>(this.dataSource, `SELECT e.id_encuesta AS "idEncuesta",e.calificacion,e.comentario,e.created_at AS "createdAt",c."RazonSocial" AS cliente,o.empresa FROM crm_encuesta_satisfaccion e LEFT JOIN cliente c ON c."IdCliente"=e.id_cliente LEFT JOIN crm_oportunidad o ON o.id_oportunidad=e.id_oportunidad ORDER BY e.created_at DESC LIMIT 100`); }
  async createEncuesta(dto: CreateEncuestaDto, idUser?: number) { if (!dto.idCliente && !dto.idOportunidad) throw new BadRequestException('Relaciona la encuesta con un cliente u oportunidad'); const rows = await queryRows<{ idEncuesta: number }>(this.dataSource, 'INSERT INTO crm_encuesta_satisfaccion(id_cliente,id_oportunidad,calificacion,comentario,id_user)VALUES($1,$2,$3,$4,$5)RETURNING id_encuesta AS "idEncuesta"', [dto.idCliente || null, dto.idOportunidad || null, dto.calificacion, dto.comentario || null, idUser ?? null]); return rows[0]; }
  metas() { return queryRows<Record<string, unknown>>(this.dataSource, `SELECT m.id_meta AS "idMeta",m.id_user AS "idUser",u.username,m.fecha_inicio AS "fechaInicio",m.fecha_fin AS "fechaFin",m.monto_objetivo AS "montoObjetivo",m.oportunidades_objetivo AS "oportunidadesObjetivo",coalesce(sum(o.monto_estimado) FILTER(WHERE o.etapa='Ganada'),0) AS "montoLogrado",count(o.id_oportunidad) FILTER(WHERE o.etapa='Ganada')::int AS "oportunidadesLogradas" FROM crm_meta_vendedor m JOIN auth_user u ON u.id_user=m.id_user LEFT JOIN crm_oportunidad o ON o.id_responsable=m.id_user AND o.updated_at::date BETWEEN m.fecha_inicio AND m.fecha_fin GROUP BY m.id_meta,u.username ORDER BY m.fecha_inicio DESC,u.username`); }
  async createMeta(dto: CreateMetaDto) { const rows = await queryRows<{ idMeta: number }>(this.dataSource, `INSERT INTO crm_meta_vendedor(id_user,fecha_inicio,fecha_fin,monto_objetivo,oportunidades_objetivo)VALUES($1,$2,$3,$4,$5) ON CONFLICT(id_user,fecha_inicio,fecha_fin)DO UPDATE SET monto_objetivo=excluded.monto_objetivo,oportunidades_objetivo=excluded.oportunidades_objetivo RETURNING id_meta AS "idMeta"`, [dto.idUser, dto.fechaInicio, dto.fechaFin, dto.montoObjetivo, dto.oportunidadesObjetivo]); return rows[0]; }

  tareas(query: CrmTareasQuery, idUser: number, role: RolUsuario) {
    const where = ['($1::boolean OR t.id_responsable=$2 OR t.id_creador=$2)'];
    const params: unknown[] = [role === RolUsuario.ADMIN, idUser];
    if (query.estado) { params.push(query.estado); where.push(`t.estado=$${params.length}`); }
    if (query.idResponsable) { params.push(query.idResponsable); where.push(`t.id_responsable=$${params.length}`); }
    if (query.vencimiento === 'vencidas') where.push("t.estado IN ('Pendiente','En progreso') AND t.fecha_vencimiento<clock_timestamp()");
    if (query.vencimiento === 'hoy') where.push("t.fecha_vencimiento::date=current_date");
    if (query.vencimiento === 'proximas') where.push("t.estado IN ('Pendiente','En progreso') AND t.fecha_vencimiento>=clock_timestamp() AND t.fecha_vencimiento<clock_timestamp()+interval '7 days'");
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT t.id_tarea AS "idTarea",t.titulo,t.descripcion,t.prioridad,t.estado,t.fecha_vencimiento AS "fechaVencimiento",t.id_responsable AS "idResponsable",u.username AS responsable,t.id_cliente AS "idCliente",c."RazonSocial" AS cliente,t.id_oportunidad AS "idOportunidad",o.empresa,t.id_unidad AS "idUnidad",cu.vin,cu.esn,t.id_cotizacion AS "idCotizacion",t.id_pedido AS "idPedido",t.version,t.created_at AS "createdAt" FROM crm_tarea t JOIN auth_user u ON u.id_user=t.id_responsable LEFT JOIN cliente c ON c."IdCliente"=t.id_cliente LEFT JOIN crm_oportunidad o ON o.id_oportunidad=t.id_oportunidad LEFT JOIN crm_unidad_cliente cu ON cu.id_unidad=t.id_unidad WHERE ${where.join(' AND ')} ORDER BY CASE t.estado WHEN 'Pendiente' THEN 1 WHEN 'En progreso' THEN 2 ELSE 3 END,CASE t.prioridad WHEN 'Urgente' THEN 1 WHEN 'Alta' THEN 2 WHEN 'Media' THEN 3 ELSE 4 END,t.fecha_vencimiento LIMIT 200`, params);
  }

  async createTarea(dto: CreateCrmTareaDto, idUser: number, role: RolUsuario) {
    if (![dto.idCliente, dto.idUnidad, dto.idOportunidad, dto.idCotizacion, dto.idPedido].some(Boolean)) throw new BadRequestException('Relaciona la tarea con un cliente, unidad, oportunidad, cotización o pedido');
    if (role !== RolUsuario.ADMIN && dto.idResponsable !== idUser) throw new BadRequestException('Solo un administrador puede asignar tareas a otro usuario');
    const rows = await queryRows<{ idTarea: number }>(this.dataSource, `INSERT INTO crm_tarea(titulo,descripcion,prioridad,fecha_vencimiento,id_responsable,id_cliente,id_unidad,id_oportunidad,id_cotizacion,id_pedido,id_creador) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id_tarea AS "idTarea"`, [dto.titulo, dto.descripcion || null, dto.prioridad, dto.fechaVencimiento, dto.idResponsable, dto.idCliente || null, dto.idUnidad || null, dto.idOportunidad || null, dto.idCotizacion || null, dto.idPedido || null, idUser]);
    return rows[0];
  }

  async updateTarea(id: number, dto: UpdateCrmTareaDto, idUser: number, role: RolUsuario) {
    return this.dataSource.transaction(async manager => {
      const rows = await queryRows<Record<string, unknown>>(manager, 'SELECT * FROM crm_tarea WHERE id_tarea=$1 FOR UPDATE', [id]);
      if (!rows.length) throw new NotFoundException('Tarea no encontrada');
      const current = rows[0];
      if (role !== RolUsuario.ADMIN && Number(current.id_responsable) !== idUser && Number(current.id_creador) !== idUser) throw new NotFoundException('Tarea no encontrada');
      if (Number(current.version) !== dto.expectedVersion) throw new ConflictException('La tarea cambió; actualiza la lista e inténtalo de nuevo');
      const estado = dto.estado ?? String(current.estado);
      const responsable = dto.idResponsable ?? Number(current.id_responsable);
      if (role !== RolUsuario.ADMIN && responsable !== Number(current.id_responsable)) throw new BadRequestException('Solo un administrador puede reasignar tareas');
      await manager.query(`UPDATE crm_tarea SET titulo=$2,descripcion=$3,prioridad=$4,estado=$5,fecha_vencimiento=$6,id_responsable=$7,id_cliente=$8,id_unidad=$9,id_oportunidad=$10,id_cotizacion=$11,id_pedido=$12,completada_at=CASE WHEN $5='Completada' THEN coalesce(completada_at,clock_timestamp()) ELSE NULL END,updated_at=clock_timestamp(),version=version+1 WHERE id_tarea=$1`, [id, dto.titulo ?? current.titulo, dto.descripcion === undefined ? current.descripcion : dto.descripcion, dto.prioridad ?? current.prioridad, estado, dto.fechaVencimiento ?? current.fecha_vencimiento, responsable, dto.idCliente === undefined ? current.id_cliente : dto.idCliente, dto.idUnidad === undefined ? current.id_unidad : dto.idUnidad, dto.idOportunidad === undefined ? current.id_oportunidad : dto.idOportunidad, dto.idCotizacion === undefined ? current.id_cotizacion : dto.idCotizacion, dto.idPedido === undefined ? current.id_pedido : dto.idPedido]);
      return { idTarea: id, version: Number(current.version) + 1 };
    });
  }

  comunicaciones(idCliente?: number, idOportunidad?: number) {
    if (!idCliente && !idOportunidad) throw new BadRequestException('Indica un cliente u oportunidad');
    return queryRows<Record<string, unknown>>(this.dataSource, `SELECT cc.id_comunicacion AS "idComunicacion",cc.canal,cc.direccion,cc.resumen,cc.fecha,cc.id_cliente AS "idCliente",c."RazonSocial" AS cliente,cc.id_oportunidad AS "idOportunidad",o.empresa,u.username FROM crm_comunicacion cc LEFT JOIN cliente c ON c."IdCliente"=cc.id_cliente LEFT JOIN crm_oportunidad o ON o.id_oportunidad=cc.id_oportunidad LEFT JOIN auth_user u ON u.id_user=cc.id_user WHERE ($1::int IS NULL OR cc.id_cliente=$1) AND ($2::int IS NULL OR cc.id_oportunidad=$2) ORDER BY cc.fecha DESC LIMIT 100`, [idCliente || null, idOportunidad || null]);
  }

  async createComunicacion(dto: CreateCrmComunicacionDto, idUser: number) {
    if (!dto.idCliente && !dto.idUnidad && !dto.idOportunidad) throw new BadRequestException('Relaciona la comunicación con un cliente, unidad u oportunidad');
    const rows = await queryRows<{ idComunicacion: number }>(this.dataSource, `INSERT INTO crm_comunicacion(canal,direccion,resumen,fecha,id_cliente,id_unidad,id_oportunidad,id_user) VALUES($1,$2,$3,coalesce($4::timestamptz,clock_timestamp()),$5,$6,$7,$8) RETURNING id_comunicacion AS "idComunicacion"`, [dto.canal, dto.direccion, dto.resumen, dto.fecha || null, dto.idCliente || null, dto.idUnidad || null, dto.idOportunidad || null, idUser]);
    return rows[0];
  }

  private async lockOportunidad(manager: EntityManager, id: number, expectedVersion?: number): Promise<OportunidadDbRow> {
    const rows = await queryRows<OportunidadDbRow>(manager, 'SELECT * FROM crm_oportunidad WHERE id_oportunidad=$1 FOR UPDATE', [id]);
    if (!rows.length) throw new NotFoundException('Oportunidad no encontrada');
    if (expectedVersion !== undefined && rows[0].version !== expectedVersion) {
      throw new ConflictException('La oportunidad cambió. Recárgala antes de guardar para conservar los cambios de otros usuarios');
    }
    return rows[0];
  }

  private validatePlan(etapa: string, motivo?: string | null, accion?: string | null, fecha?: string | null) {
    if (etapa === 'Perdida' && !motivo?.trim()) {
      throw new BadRequestException('Indica el motivo cuando una oportunidad se pierde');
    }
    if (!CLOSED.includes(etapa) && fecha && !accion?.trim()) {
      throw new BadRequestException('Describe la siguiente acción para programar una fecha');
    }
  }

  private validateUnidad(vin?: string | null, esn?: string | null) {
    const cleanVin = this.normalizeVin(vin);
    const cleanEsn = this.normalizeEsn(esn);
    if (!cleanVin && !cleanEsn) throw new BadRequestException('Captura el VIN del camión o el ESN del motor');
    if (cleanVin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(cleanVin)) {
      throw new BadRequestException('El VIN debe contener 17 caracteres válidos; no usa I, O ni Q');
    }
    if (cleanEsn && cleanEsn.length < 3) throw new BadRequestException('El ESN debe contener al menos 3 caracteres');
  }

  private async ensureClienteExists(source: { query: (sql: string, parameters?: unknown[]) => Promise<unknown> }, idCliente: number) {
    const rows = await queryRows<{ id: number }>(source, 'SELECT "IdCliente" AS id FROM cliente WHERE "IdCliente"=$1', [idCliente]);
    if (!rows.length) throw new NotFoundException('Cliente no encontrado');
  }

  private normalizeVin(value?: string | null) { return value?.replace(/[\s-]/g, '').toUpperCase() || null; }
  private normalizeEsn(value?: string | null) { return value?.trim().toUpperCase() || null; }
}
