import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CreateCampanaDto,
  CreateEncuestaDto,
  CreateMetaDto,
  CreatePlantillaDto,
  CreateSegmentoDto,
} from './crm.dto';
import { queryRows } from '../common/database/typed-query';
import { commercialSegmentPredicate } from './campana-consentimiento-policy';
@Injectable()
export class CrmComercialService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}
  segmentos() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT s.id_segmento AS "idSegmento",s.nombre,s.descripcion,s.tipo_cliente AS "tipoCliente",s.dias_inactivo AS "diasInactivo",s.activo,s.created_at AS "createdAt",(SELECT count(*)::int FROM cliente c WHERE ${commercialSegmentPredicate}) AS clientes FROM crm_segmento s ORDER BY s.nombre`,
    );
  }

  async createSegmento(dto: CreateSegmentoDto, idUser?: number) {
    const rows = await queryRows<{ idSegmento: number }>(
      this.dataSource,
      'INSERT INTO crm_segmento(nombre,descripcion,tipo_cliente,dias_inactivo,id_user)VALUES($1,$2,$3,$4,$5)RETURNING id_segmento AS "idSegmento"',
      [
        dto.nombre,
        dto.descripcion || null,
        dto.tipoCliente || null,
        dto.diasInactivo ?? null,
        idUser ?? null,
      ],
    );
    return rows[0];
  }

  plantillas() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT id_plantilla AS "idPlantilla",nombre,canal,asunto,contenido,activa,created_at AS "createdAt" FROM crm_plantilla ORDER BY activa DESC,nombre`,
    );
  }

  async createPlantilla(dto: CreatePlantillaDto, idUser?: number) {
    const rows = await queryRows<{ idPlantilla: number }>(
      this.dataSource,
      'INSERT INTO crm_plantilla(nombre,canal,asunto,contenido,id_user)VALUES($1,$2,$3,$4,$5)RETURNING id_plantilla AS "idPlantilla"',
      [
        dto.nombre,
        dto.canal,
        dto.asunto || null,
        dto.contenido,
        idUser ?? null,
      ],
    );
    return rows[0];
  }

  campanas() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT c.id_campana AS "idCampana",c.nombre,c.estado,c.fecha_inicio AS "fechaInicio",c.fecha_fin AS "fechaFin",c.objetivo,s.nombre AS segmento,p.nombre AS plantilla,p.canal FROM crm_campana c LEFT JOIN crm_segmento s ON s.id_segmento=c.id_segmento LEFT JOIN crm_plantilla p ON p.id_plantilla=c.id_plantilla ORDER BY c.created_at DESC`,
    );
  }

  async createCampana(dto: CreateCampanaDto, idUser?: number) {
    const rows = await queryRows<{ idCampana: number }>(
      this.dataSource,
      'INSERT INTO crm_campana(nombre,id_segmento,id_plantilla,fecha_inicio,fecha_fin,objetivo,id_user)VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING id_campana AS "idCampana"',
      [
        dto.nombre,
        dto.idSegmento || null,
        dto.idPlantilla || null,
        dto.fechaInicio || null,
        dto.fechaFin || null,
        dto.objetivo || null,
        idUser ?? null,
      ],
    );
    return rows[0];
  }

  encuestas() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT e.id_encuesta AS "idEncuesta",e.calificacion,e.comentario,e.created_at AS "createdAt",c."RazonSocial" AS cliente,o.empresa FROM crm_encuesta_satisfaccion e LEFT JOIN cliente c ON c."IdCliente"=e.id_cliente LEFT JOIN crm_oportunidad o ON o.id_oportunidad=e.id_oportunidad ORDER BY e.created_at DESC LIMIT 100`,
    );
  }

  async createEncuesta(dto: CreateEncuestaDto, idUser?: number) {
    if (!dto.idCliente && !dto.idOportunidad)
      throw new BadRequestException(
        'Relaciona la encuesta con un cliente u oportunidad',
      );
    const rows = await queryRows<{ idEncuesta: number }>(
      this.dataSource,
      'INSERT INTO crm_encuesta_satisfaccion(id_cliente,id_oportunidad,calificacion,comentario,id_user)VALUES($1,$2,$3,$4,$5)RETURNING id_encuesta AS "idEncuesta"',
      [
        dto.idCliente || null,
        dto.idOportunidad || null,
        dto.calificacion,
        dto.comentario || null,
        idUser ?? null,
      ],
    );
    return rows[0];
  }

  metas() {
    return queryRows<Record<string, unknown>>(
      this.dataSource,
      `SELECT m.id_meta AS "idMeta",m.id_user AS "idUser",u.username,m.fecha_inicio AS "fechaInicio",m.fecha_fin AS "fechaFin",m.monto_objetivo AS "montoObjetivo",m.oportunidades_objetivo AS "oportunidadesObjetivo",coalesce(sum(o.monto_estimado) FILTER(WHERE o.etapa='Ganada'),0) AS "montoLogrado",count(o.id_oportunidad) FILTER(WHERE o.etapa='Ganada')::int AS "oportunidadesLogradas" FROM crm_meta_vendedor m JOIN auth_user u ON u.id_user=m.id_user LEFT JOIN crm_oportunidad o ON o.id_responsable=m.id_user AND o.updated_at::date BETWEEN m.fecha_inicio AND m.fecha_fin GROUP BY m.id_meta,u.username ORDER BY m.fecha_inicio DESC,u.username`,
    );
  }

  async createMeta(dto: CreateMetaDto) {
    const rows = await queryRows<{ idMeta: number }>(
      this.dataSource,
      `INSERT INTO crm_meta_vendedor(id_user,fecha_inicio,fecha_fin,monto_objetivo,oportunidades_objetivo)VALUES($1,$2,$3,$4,$5) ON CONFLICT(id_user,fecha_inicio,fecha_fin)DO UPDATE SET monto_objetivo=excluded.monto_objetivo,oportunidades_objetivo=excluded.oportunidades_objetivo RETURNING id_meta AS "idMeta"`,
      [
        dto.idUser,
        dto.fechaInicio,
        dto.fechaFin,
        dto.montoObjetivo,
        dto.oportunidadesObjetivo,
      ],
    );
    return rows[0];
  }
}
