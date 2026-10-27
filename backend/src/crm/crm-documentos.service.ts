import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { QueryExecutor, queryRows, readSnapshot } from '../common/database/typed-query';
import { commercialSalesCtes } from './crm-commercial-query';

export interface OpportunityLink { idOportunidad: number; idCliente: number | null; version: number; cliente: string | null }
export interface LinkedQuote {
  idCotizacion: number; folio: number; fechaEmision: Date; estatus: string; linkedAt: Date;
  documentosVenta: number; cancelados: number; inconsistentes: number;
}

@Injectable()
export class CrmDocumentosService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private async opportunity(source: QueryExecutor, id: number, user: number, admin: boolean, lock = false) {
    const [row] = await queryRows<OpportunityLink>(source,
      `SELECT o.id_oportunidad AS "idOportunidad",o.id_cliente AS "idCliente",o.version,c."RazonSocial" AS cliente
       FROM crm_oportunidad o LEFT JOIN cliente c ON c."IdCliente"=o.id_cliente
       WHERE o.id_oportunidad=$1 AND ($2::boolean OR o.id_responsable=$3) ${lock ? 'FOR UPDATE OF o' : ''}`, [id, admin, user]);
    if (!row) throw new NotFoundException('Oportunidad no disponible');
    return row;
  }

  async list(id: number, user: number, admin: boolean) {
    return readSnapshot(this.db, async source => {
      await source.query("SET LOCAL statement_timeout='5s'");
      const opportunity = await this.opportunity(source, id, user, admin);
      const quotes = await queryRows<LinkedQuote>(source, `WITH linked_quotes AS (
        SELECT * FROM crm_oportunidad_cotizacion WHERE id_oportunidad=$1
      ), ${commercialSalesCtes}
      SELECT q.id_cotizacion AS "idCotizacion",q.folio,q.fecha_emision AS "fechaEmision",q.estatus,m.created_at AS "linkedAt",
        (SELECT count(DISTINCT id_factura)::int FROM valid_sales v WHERE v.id_cotizacion=q.id_cotizacion) AS "documentosVenta",
        (SELECT count(DISTINCT id_factura)::int FROM sale_links s WHERE s.id_cotizacion=q.id_cotizacion AND coherent AND cancelled) AS cancelados,
        (SELECT count(DISTINCT id_factura)::int FROM sale_links s WHERE s.id_cotizacion=q.id_cotizacion AND NOT coherent) AS inconsistentes
      FROM linked_quotes m JOIN cotizacion q USING(id_cotizacion) ORDER BY m.created_at DESC,q.id_cotizacion DESC LIMIT 101`, [id]);
      return { opportunity, quotes: quotes.slice(0, 100), truncated: quotes.length > 100 };
    });
  }

  async candidates(id: number, term: string, user: number, admin: boolean) {
    return readSnapshot(this.db, async source => {
      await source.query("SET LOCAL statement_timeout='5s'");
      const opportunity = await this.opportunity(source, id, user, admin);
      if (!opportunity.idCliente) return [];
      const literal = '%' + term.trim().replace(/[\\%_]/g, '\\$&') + '%';
      return queryRows<{ idCotizacion: number; folio: number; fechaEmision: Date; estatus: string }>(source,
        `SELECT q.id_cotizacion AS "idCotizacion",q.folio,q.fecha_emision AS "fechaEmision",q.estatus FROM cotizacion q
         WHERE q.id_cliente=$1 AND (q.folio::text ILIKE $2 OR ('C-'||q.folio::text) ILIKE $2)
         AND NOT EXISTS(SELECT 1 FROM crm_oportunidad_cotizacion m WHERE m.id_cotizacion=q.id_cotizacion)
         ORDER BY q.fecha_emision DESC,q.id_cotizacion DESC LIMIT 20`, [opportunity.idCliente, literal]);
    });
  }

  async client(id: number, client: number, version: number, user: number, admin: boolean) {
    return this.db.transaction(async manager => {
      const opportunity = await this.opportunity(manager, id, user, admin, true);
      if (opportunity.idCliente === client) return { version: opportunity.version, idCliente: client };
      if (opportunity.version !== version) throw new ConflictException('Recarga la oportunidad antes de asociar el cliente');
      const [exists] = await queryRows<{ id: number }>(manager, 'SELECT "IdCliente" AS id FROM cliente WHERE "IdCliente"=$1 FOR KEY SHARE', [client]);
      if (!exists) throw new BadRequestException('Cliente no disponible');
      const links = await queryRows<{ id: number }>(manager,
        'SELECT id_cotizacion AS id FROM crm_oportunidad_cotizacion WHERE id_oportunidad=$1 LIMIT 1', [id]);
      if (links.length) throw new ConflictException('Retira los vínculos de cotizaciones antes de cambiar de cliente');
      await manager.query('UPDATE crm_oportunidad SET id_cliente=$2,version=version+1,updated_at=clock_timestamp() WHERE id_oportunidad=$1', [id, client]);
      await this.history(manager, id, user, `Cliente ERP #${client} asociado manualmente a la oportunidad.`);
      return { version: opportunity.version + 1, idCliente: client };
    });
  }

  async link(id: number, quote: number, version: number, user: number, admin: boolean) {
    return this.db.transaction(async manager => {
      const opportunity = await this.opportunity(manager, id, user, admin, true);
      const existing = await queryRows<{ id: number }>(manager,
        'SELECT id_oportunidad AS id FROM crm_oportunidad_cotizacion WHERE id_cotizacion=$1', [quote]);
      if (existing.length) {
        if (existing[0].id !== id) throw new ConflictException('La cotización ya pertenece a otra oportunidad');
        return { version: opportunity.version, idCotizacion: quote };
      }
      if (opportunity.version !== version) throw new ConflictException('Recarga la oportunidad antes de vincular');
      const [candidate] = await queryRows<{ idCliente: number; folio: number }>(manager,
        'SELECT id_cliente AS "idCliente",folio FROM cotizacion WHERE id_cotizacion=$1 FOR KEY SHARE', [quote]);
      if (!candidate) throw new NotFoundException('Cotización no disponible');
      if (!opportunity.idCliente || opportunity.idCliente !== candidate.idCliente)
        throw new ConflictException('La oportunidad y la cotización deben pertenecer al mismo cliente ERP');
      const [{ count }] = await queryRows<{ count: number }>(manager,
        'SELECT count(*)::int AS count FROM crm_oportunidad_cotizacion WHERE id_oportunidad=$1', [id]);
      if (count >= 100) throw new BadRequestException('Máximo 100 cotizaciones por oportunidad');
      const inserted = await queryRows<{ id: number }>(manager, `INSERT INTO crm_oportunidad_cotizacion(id_oportunidad,id_cotizacion,id_cliente,id_autor)
        VALUES($1,$2,$3,$4) ON CONFLICT(id_cotizacion) DO NOTHING RETURNING id_cotizacion AS id`, [id, quote, candidate.idCliente, user]);
      if (!inserted.length) throw new ConflictException('Otra oportunidad acaba de vincular esta cotización');
      await manager.query('UPDATE crm_oportunidad SET version=version+1,updated_at=clock_timestamp() WHERE id_oportunidad=$1', [id]);
      await this.history(manager, id, user, `Cotización C-${candidate.folio} (#${quote}) vinculada con confirmación manual de su origen comercial.`);
      return { version: opportunity.version + 1, idCotizacion: quote };
    });
  }

  async unlink(id: number, quote: number, version: number, user: number, admin: boolean) {
    return this.db.transaction(async manager => {
      const opportunity = await this.opportunity(manager, id, user, admin, true);
      const exists = await queryRows<{ id: number }>(manager,
        'SELECT id_cotizacion AS id FROM crm_oportunidad_cotizacion WHERE id_oportunidad=$1 AND id_cotizacion=$2', [id, quote]);
      if (!exists.length) return { version: opportunity.version, removed: true };
      if (opportunity.version !== version) throw new ConflictException('Recarga la oportunidad antes de retirar el vínculo');
      await manager.query('DELETE FROM crm_oportunidad_cotizacion WHERE id_oportunidad=$1 AND id_cotizacion=$2', [id, quote]);
      await manager.query('UPDATE crm_oportunidad SET version=version+1,updated_at=clock_timestamp() WHERE id_oportunidad=$1', [id]);
      await this.history(manager, id, user, `Vínculo de cotización #${quote} retirado manualmente; sus documentos de venta se conservan.`);
      return { version: opportunity.version + 1, removed: true };
    });
  }

  private history(source: QueryExecutor, id: number, user: number, detail: string) {
    return source.query("INSERT INTO crm_seguimiento(id_oportunidad,tipo,detalle,id_user) VALUES($1,'Nota',$2,$3)", [id, detail, user]);
  }
}
