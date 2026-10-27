import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { queryRows } from '../common/database/typed-query';

export interface ValidatedWebLead {
  schemaVersion: 1;
  requestId: string;
  origin: 'public-web';
  contact: { name: string; channel: string; value: string };
  items: Record<string, string | number>[];
  privacy: { accepted: true; version: string };
}

export interface WebLeadReceiptStatus {
  requestId: string;
  estado: string;
  version: number;
  createdAt: Date;
  expiresAt: Date;
  idOportunidad: number | null;
  contenido: 'Vigente' | 'Vencido' | 'Purgado';
}

export type WebResolutionReason = 'Contenido' | 'Catalogo' | 'Clave' | 'Confirmacion';
export interface WebLeadResolution {
  operationId: string; requestId: string; motivo: WebResolutionReason;
  decision: 'ConservarOriginal'; expectedVersion: number; version: number;
  contenido: string; idOportunidad: number | null; idAutor: number; createdAt: Date;
}
const resolutionProjection = `operation_id AS "operationId",request_id AS "requestId",motivo,decision,
  expected_version AS "expectedVersion",version_resultante AS version,contenido,
  id_oportunidad AS "idOportunidad",id_autor AS "idAutor",created_at AS "createdAt"`;

@Injectable()
export class CrmSolicitudesWebService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  // Internal boundary only: caller must validate with WEB05.1a and compute HMAC.
  // No controller exposes ingestion or contact lookup.
  async receive(lead: ValidatedWebLead, fingerprint: string) {
    if (!/^[a-f0-9]{64}$/.test(fingerprint) || lead.origin !== 'public-web') {
      throw new ConflictException('Solicitud inválida');
    }
    return this.db.transaction(async manager => {
      const inserted = await queryRows<{ requestId: string }>(manager,
        `INSERT INTO crm_solicitud_web(request_id,fingerprint,payload)
         VALUES ($1,$2,$3::jsonb) ON CONFLICT (request_id) DO NOTHING
         RETURNING request_id AS "requestId"`,
        [lead.requestId, fingerprint, JSON.stringify(lead)]);
      if (!inserted.length) {
        const [existing] = await queryRows<{ fingerprint: string }>(manager,
          'SELECT fingerprint FROM crm_solicitud_web WHERE request_id=$1 FOR UPDATE', [lead.requestId]);
        if (!existing || existing.fingerprint !== fingerprint) {
          throw new ConflictException('Identificador de solicitud ya utilizado');
        }
      }
      return { requestId: lead.requestId, received: true };
    });
  }

  async list(page: number, limit: number) {
    // Expired payloads are never returned, even before the cleanup runs.
    return queryRows<Record<string, unknown>>(this.db,
      `SELECT request_id AS "requestId", estado, version, created_at AS "createdAt",
       expires_at AS "expiresAt", id_oportunidad AS "idOportunidad", payload FROM crm_solicitud_web
       WHERE expires_at>clock_timestamp() AND payload IS NOT NULL
       ORDER BY created_at DESC,request_id LIMIT $1 OFFSET $2`, [limit, (page - 1) * limit]);
  }

  // Private reconciliation only. Never return contact, pieces or fingerprint;
  // retained metadata may outlive payload retention and an opportunity link.
  async receiptStatus(id: string): Promise<WebLeadReceiptStatus> {
    const [row] = await queryRows<WebLeadReceiptStatus>(this.db,
      `SELECT request_id AS "requestId", estado, version,
       created_at AS "createdAt", expires_at AS "expiresAt",
       id_oportunidad AS "idOportunidad",
       CASE WHEN payload IS NULL THEN 'Purgado'
         WHEN expires_at<=statement_timestamp() THEN 'Vencido'
         ELSE 'Vigente' END AS contenido
       FROM crm_solicitud_web WHERE request_id=$1`, [id]);
    if (!row) throw new NotFoundException('Solicitud no encontrada');
    return row;
  }

  async review(id: string, estado: string, version: number, user: number) {
    const rows = await queryRows<{ requestId: string; version: number }>(this.db,
      `WITH changed AS (UPDATE crm_solicitud_web SET estado=$2,version=version+1,
       revisada_por=$4,updated_at=clock_timestamp()
       WHERE request_id=$1 AND version=$3 AND expires_at>clock_timestamp() AND payload IS NOT NULL AND id_oportunidad IS NULL
       RETURNING request_id AS "requestId",version) SELECT * FROM changed`, [id, estado, version, user]);
    if (!rows.length) throw new NotFoundException('Solicitud no vigente o versión desactualizada');
    return rows[0];
  }

  async resolutions(id: string): Promise<WebLeadResolution[]> {
    await this.receiptStatus(id);
    return queryRows<WebLeadResolution>(this.db, `SELECT ${resolutionProjection}
      FROM crm_solicitud_web_resolucion WHERE request_id=$1 ORDER BY version_resultante DESC LIMIT 20`, [id]);
  }

  // ADMIN records a reviewed decision, not a claim that the conflicting payload matched.
  // The original HMAC/content and expiry are never rewritten or extended.
  async resolve(id: string, operationId: string, motivo: WebResolutionReason, version: number, user: number) {
    id = id.toLowerCase(); operationId = operationId.toLowerCase();
    return this.db.transaction(async manager => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['web-resolution:' + operationId]);
      const [previous] = await queryRows<WebLeadResolution>(manager,
        `SELECT ${resolutionProjection} FROM crm_solicitud_web_resolucion WHERE operation_id=$1`, [operationId]);
      if (previous) {
        if (previous.requestId !== id || previous.motivo !== motivo || previous.expectedVersion !== version || previous.idAutor !== user)
          throw new ConflictException('Identificador de decisión ya utilizado con otros datos');
        return previous;
      }
      const [original] = await queryRows<{ version: number; contenido: string; idOportunidad: number | null }>(manager,
        `SELECT version,id_oportunidad AS "idOportunidad",CASE WHEN payload IS NULL THEN 'Purgado'
          WHEN expires_at<=clock_timestamp() THEN 'Vencido' ELSE 'Vigente' END AS contenido
         FROM crm_solicitud_web WHERE request_id=$1 FOR UPDATE`, [id]);
      if (!original) throw new NotFoundException('Solicitud no encontrada');
      if (original.version !== version) throw new ConflictException('Actualiza el diagnóstico antes de registrar la decisión');
      const [result] = await queryRows<WebLeadResolution>(manager,
        `INSERT INTO crm_solicitud_web_resolucion(operation_id,request_id,motivo,expected_version,
          version_resultante,contenido,id_oportunidad,id_autor) VALUES($1,$2,$3,$4,$4+1,$5,$6,$7)
         RETURNING ${resolutionProjection}`, [operationId, id, motivo, version, original.contenido, original.idOportunidad, user]);
      await manager.query(`UPDATE crm_solicitud_web SET version=version+1,updated_at=clock_timestamp()
        WHERE request_id=$1`, [id]);
      return result;
    });
  }

  async purgeExpired() {
    const rows = await queryRows<{ requestId: string }>(this.db, `WITH expired AS (
      SELECT request_id FROM crm_solicitud_web WHERE payload IS NOT NULL
      AND expires_at<=clock_timestamp() ORDER BY expires_at,request_id
      LIMIT 1000 FOR UPDATE SKIP LOCKED
    ), changed AS (UPDATE crm_solicitud_web SET payload=NULL,
      updated_at=clock_timestamp(),version=version+1 WHERE payload IS NOT NULL
      AND request_id IN (SELECT request_id FROM expired)
      RETURNING request_id AS "requestId") SELECT * FROM changed`);
    return { purged: rows.length };
  }

  async convert(id: string, version: number, user: number, idResponsable = user) {
    return this.db.transaction(async manager => {
      const [row] = await queryRows<{ payload: ValidatedWebLead | null; estado: string; version: number;
        expiresAt: Date; idOportunidad: number | null }>(manager,
        `SELECT payload,estado,version,expires_at AS "expiresAt",id_oportunidad AS "idOportunidad"
         FROM crm_solicitud_web WHERE request_id=$1 FOR UPDATE`, [id]);
      if (!row) throw new NotFoundException('Solicitud no encontrada');
      if (row.idOportunidad) return { idOportunidad: row.idOportunidad };
      if (!row.payload || row.estado === 'Descartada' || row.expiresAt.getTime() <= Date.now())
        throw new ConflictException('Solicitud no vigente para conversión');
      if (row.version !== version) throw new ConflictException('Actualiza la solicitud antes de convertir');
      const contact = row.payload.contact;
      if (contact.channel === 'email' && contact.value.length > 150)
        throw new BadRequestException('El correo excede el límite del CRM; requiere revisión manual');
      const [owner] = await queryRows<{ id: number }>(manager,
        'SELECT id_user AS id FROM auth_user WHERE id_user=$1 AND is_active', [idResponsable]);
      if (!owner) throw new ConflictException('Responsable no activo');
      const [opportunity] = await queryRows<{ idOportunidad: number }>(manager,
        `INSERT INTO crm_oportunidad(empresa,contacto,telefono,email,tipo_cliente,etapa,
          monto_estimado,siguiente_accion,id_responsable)
         VALUES ($1,$1,$2,$3,'Otro','Prospecto',0,'Revisar consulta web y confirmar piezas',$4)
         RETURNING id_oportunidad AS "idOportunidad"`,
        [contact.name, contact.channel === 'email' ? null : contact.value,
          contact.channel === 'email' ? contact.value : null, idResponsable]);
      await manager.query(`INSERT INTO crm_oportunidad_consulta_web(id_oportunidad,request_id,piezas,id_autor)
        VALUES ($1,$2,$3::jsonb,$4)`, [opportunity.idOportunidad, id, JSON.stringify(row.payload.items), user]);
      await manager.query(`INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user)
        VALUES ($1,'Nota',$2,$3)`, [opportunity.idOportunidad,
        'Origen: web pública. Solicitud ' + id + '. Piezas y cantidades conservadas en snapshot. Precio y compatibilidad pendientes.', user]);
      await manager.query(`UPDATE crm_solicitud_web SET id_oportunidad=$2,estado='Revisada',
        version=version+1,revisada_por=$3,updated_at=clock_timestamp() WHERE request_id=$1`, [id, opportunity.idOportunidad, user]);
      return opportunity;
    });
  }
  async snapshot(id: number, user: number, admin: boolean) {
    const [row] = await queryRows<{ requestId: string | null; piezas: Record<string, string | number>[] | null; createdAt: Date | null }>(this.db,
      `SELECT s.request_id AS "requestId",s.piezas,s.created_at AS "createdAt"
       FROM crm_oportunidad o LEFT JOIN crm_oportunidad_consulta_web s USING(id_oportunidad)
       WHERE o.id_oportunidad=$1 AND ($2::boolean OR o.id_responsable=$3)`, [id, admin, user]);
    if (!row) throw new NotFoundException('Oportunidad no disponible');
    return row.requestId ? row : null;
  }
}
