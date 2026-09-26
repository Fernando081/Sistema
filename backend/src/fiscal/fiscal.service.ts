import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { queryRows } from '../common/database/typed-query';
import { loadFiscalSettings } from './fiscal.config';
import { FiscalXmlBuilder } from './fiscal-xml.builder';
import { CancelFiscalDocumentDto } from './fiscal.dto';
import { FISCAL_PROVIDER } from './fiscal.types';
import type { CancelInput, CancelResult, FiscalDocumentState, FiscalDocumentType, FiscalProvider } from './fiscal.types';

interface FiscalRow {
  id_documento: number; tipo: FiscalDocumentType; id_factura: number | null; id_rep: number | null;
  proveedor: string; ambiente: string; estado: FiscalDocumentState; uuid: string | null;
  xml_timbrado: string | null; acuse_cancelacion: string | null; sello_cfdi: string | null;
  motivo_cancelacion: string | null; folio_sustitucion: string | null; ultimo_error: string | null;
  fecha_timbrado: Date | string | null; fecha_cancelacion: Date | string | null;
  updated_at: Date | string;
}
interface FiscalOriginRow { receiver_rfc: string; total: number | string; business_state: string; }

const safeErrorMessage = (error: unknown) => {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message).slice(0, 1000);
  return 'Error fiscal no identificado';
};

@Injectable()
export class FiscalService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly xmlBuilder: FiscalXmlBuilder,
    @Inject(FISCAL_PROVIDER) private readonly provider: FiscalProvider,
  ) {}

  configurationStatus() {
    const settings = loadFiscalSettings(this.config);
    return {
      environment: settings.environment,
      provider: settings.provider,
      ready: settings.ready,
      missing: settings.missing,
      issuerConfigured: Boolean(settings.issuer.rfc && settings.issuer.name && settings.issuer.taxRegime && settings.issuer.postalCode),
      productionEnabled: settings.productionEnabled,
    };
  }

  private ensureReady() {
    const settings = loadFiscalSettings(this.config);
    if (!settings.ready) throw new BadRequestException(`Configuración fiscal incompleta: ${settings.missing.join(', ')}`);
    return settings;
  }

  private originColumn(type: FiscalDocumentType) {
    return type === 'FACTURA'
      ? { column: 'id_factura', table: 'factura', id: 'id_factura', state: 'estatus' }
      : { column: 'id_rep', table: 'rep', id: 'id_rep', state: 'estado' };
  }

  private async findDocument(type: FiscalDocumentType, id: number, runner: DataSource | QueryRunner = this.dataSource) {
    const { column } = this.originColumn(type);
    const rows = await queryRows<FiscalRow>(runner,
      `SELECT * FROM fiscal_documento WHERE ${column}=$1`, [id]);
    return rows[0] || null;
  }

  async getDocument(type: FiscalDocumentType, id: number) {
    const document = await this.findDocument(type, id);
    if (!document) return { tipo: type, estado: 'Borrador', uuid: null, fiscal: false };
    const { xml_timbrado: _xml, acuse_cancelacion: _ack, sello_cfdi: _seal, ...safe } = document;
    void _seal;
    return { ...safe, fiscal: true, hasXml: Boolean(_xml), hasAcknowledgement: Boolean(_ack) };
  }

  async getEvents(type: FiscalDocumentType, id: number) {
    const document = await this.findDocument(type, id);
    if (!document) return [];
    return queryRows<Record<string, unknown>>(this.dataSource, `
      SELECT tipo,exito,codigo,mensaje,detalle,created_at
      FROM fiscal_evento WHERE id_documento=$1 ORDER BY created_at DESC`, [document.id_documento]);
  }

  private async event(runner: QueryRunner, documentId: number, type: string, success: boolean,
    userId?: number, code?: string, message?: string, detail: Record<string, unknown> = {}) {
    await runner.query(`INSERT INTO fiscal_evento(id_documento,tipo,exito,codigo,mensaje,detalle,id_user)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [documentId, type, success, code || null, message?.slice(0, 1000) || null, JSON.stringify(detail), userId ?? null]);
  }

  async stamp(type: FiscalDocumentType, id: number, userId?: number) {
    const settings = this.ensureReady();
    const origin = this.originColumn(type);
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let documentId = 0;
    try {
      const exists = await queryRows<{ business_state: string }>(runner,
        `SELECT COALESCE(${origin.state}::text,'') AS business_state FROM ${origin.table} WHERE ${origin.id}=$1 FOR UPDATE`, [id]);
      if (!exists.length) throw new NotFoundException(type === 'FACTURA' ? 'Factura no encontrada' : 'REP no encontrado');
      if (exists[0].business_state === 'Cancelada' || exists[0].business_state === 'Cancelado') {
        throw new ConflictException('No se puede timbrar un documento operativo cancelado');
      }
      await runner.query(`INSERT INTO fiscal_documento(tipo,${origin.column},proveedor,ambiente,estado,id_user)
        VALUES($1,$2,$3,$4,'Borrador',$5) ON CONFLICT DO NOTHING`,
      [type, id, this.provider.name, settings.environment, userId ?? null]);
      const documents = await queryRows<FiscalRow>(runner,
        `SELECT * FROM fiscal_documento WHERE ${origin.column}=$1 FOR UPDATE`, [id]);
      const document = documents[0];
      documentId = document.id_documento;
      if (document.ambiente !== settings.environment || document.proveedor !== this.provider.name) {
        throw new ConflictException(
          `El documento fiscal pertenece al ambiente ${document.ambiente}/${document.proveedor}; no puede procesarse en ${settings.environment}/${this.provider.name}`,
        );
      }
      if (document.estado === 'Timbrado' || document.estado === 'Cancelacion solicitada' || document.estado === 'Cancelado') {
        await runner.commitTransaction();
        return this.getDocument(type, id);
      }
      const processingAge = Date.now() - new Date(document.updated_at).getTime();
      if (document.estado === 'Procesando' && document.ultimo_error === null && processingAge < 5 * 60_000) {
        throw new ConflictException('El documento ya tiene un timbrado en proceso');
      }
      await runner.query(`UPDATE fiscal_documento SET estado='Procesando',ultimo_error=NULL,
        intentos=intentos+1,updated_at=clock_timestamp(),id_user=$2 WHERE id_documento=$1`,
      [documentId, userId ?? null]);
      await this.event(runner, documentId, 'TIMBRADO_INICIADO', true, userId);
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }

    try {
      const xml = type === 'FACTURA'
        ? await this.xmlBuilder.buildInvoice(id)
        : await this.xmlBuilder.buildRep(id);
      const result = await this.provider.stamp({ xml, idempotencyKey: `${settings.environment}:${type}:${id}` });
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result.uuid)) {
        throw new Error('El PAC devolvió un UUID inválido');
      }
      const finish = this.dataSource.createQueryRunner();
      await finish.connect(); await finish.startTransaction();
      try {
        await finish.query(`UPDATE fiscal_documento SET estado='Timbrado',uuid=$2,xml_timbrado=$3,
          fecha_timbrado=$4,no_certificado_sat=$5,no_certificado_cfdi=$6,sello_sat=$7,sello_cfdi=$8,
          cadena_original_sat=$9,ultimo_error=NULL,updated_at=clock_timestamp() WHERE id_documento=$1`,
        [documentId, result.uuid, result.xml, result.stampedAt, result.satCertificate || null,
          result.cfdiCertificate || null, result.satSeal || null, result.cfdiSeal || null,
          result.satOriginalString || null]);
        if (type === 'FACTURA') {
          await finish.query('UPDATE factura SET uuid=$2 WHERE id_factura=$1', [id, result.uuid]);
        } else {
          await finish.query(`UPDATE rep SET uuid=$2,no_serie_certificado=$3,no_certificado_emisor=$4,
            sello_sat=$5,sello_cfdi=$6,cadena_original=$7 WHERE id_rep=$1`,
          [id, result.uuid, result.satCertificate || null, result.cfdiCertificate || null,
            result.satSeal || null, result.cfdiSeal || null, result.satOriginalString || null]);
        }
        await this.event(finish, documentId, 'TIMBRADO_COMPLETADO', true, userId,
          result.providerCode, result.providerMessage, { uuid: result.uuid, environment: settings.environment });
        await finish.commitTransaction();
      } catch (error) { await finish.rollbackTransaction(); throw error; }
      finally { await finish.release(); }
      return this.getDocument(type, id);
    } catch (error) {
      const message = safeErrorMessage(error);
      await this.dataSource.query(`UPDATE fiscal_documento SET estado='Error',ultimo_error=$2,
        updated_at=clock_timestamp() WHERE id_documento=$1`, [documentId, message]);
      await this.dataSource.query(`INSERT INTO fiscal_evento(id_documento,tipo,exito,mensaje,id_user)
        VALUES($1,'TIMBRADO_ERROR',false,$2,$3)`, [documentId, message, userId ?? null]);
      throw error;
    }
  }

  private async cancellationInput(type: FiscalDocumentType, id: number, document: FiscalRow,
    dto: CancelFiscalDocumentDto): Promise<CancelInput> {
    if (!dto.motivo) throw new BadRequestException('Selecciona el motivo SAT de cancelación');
    if (dto.motivo === '01' && !dto.folioSustitucion) {
      throw new BadRequestException('El motivo 01 requiere el UUID que sustituye al comprobante');
    }
    if (dto.motivo !== '01' && dto.folioSustitucion) {
      throw new BadRequestException('El folio de sustitución solo corresponde al motivo 01');
    }
    const rows = type === 'FACTURA'
      ? await queryRows<FiscalOriginRow>(this.dataSource,
          `SELECT rfc_receptor AS receiver_rfc,total,estatus::text AS business_state FROM factura WHERE id_factura=$1`, [id])
      : await queryRows<FiscalOriginRow>(this.dataSource,
          `SELECT c."RFC" AS receiver_rfc,0 AS total,r.estado AS business_state
           FROM rep r JOIN cliente c ON c."IdCliente"=r.id_cliente WHERE r.id_rep=$1`, [id]);
    if (!rows.length) throw new NotFoundException('Documento de origen no encontrado');
    const settings = this.ensureReady();
    return {
      uuid: document.uuid!, issuerRfc: settings.issuer.rfc || 'EKU9003173C9',
      receiverRfc: rows[0].receiver_rfc, total: Number(rows[0].total),
      cfdiSeal: document.sello_cfdi || '', reason: dto.motivo, replacementUuid: dto.folioSustitucion,
    };
  }

  async cancel(type: FiscalDocumentType, id: number, dto: CancelFiscalDocumentDto, userId?: number) {
    const document = await this.findDocument(type, id);
    if (!document || !document.uuid || document.estado === 'Borrador' || document.estado === 'Error') {
      return { fiscal: false, cancelled: true, state: 'Sin timbrar' };
    }
    if (document.estado === 'Cancelado') return { fiscal: true, cancelled: true, state: document.estado };
    const settings = this.ensureReady();
    if (document.ambiente !== settings.environment || document.proveedor !== this.provider.name) {
      throw new ConflictException(
        `El documento fiscal pertenece al ambiente ${document.ambiente}/${document.proveedor}; no puede cancelarse en ${settings.environment}/${this.provider.name}`,
      );
    }
    const effectiveDto = document.estado === 'Cancelacion solicitada'
      ? { motivo: document.motivo_cancelacion as CancelFiscalDocumentDto['motivo'], folioSustitucion: document.folio_sustitucion || undefined }
      : dto;
    const input = await this.cancellationInput(type, id, document, effectiveDto);
    if (document.estado === 'Cancelacion solicitada') return this.reconcile(type, id, input, userId);

    let result: CancelResult;
    try {
      result = await this.provider.cancel(input);
    } catch (error) {
      const message = safeErrorMessage(error);
      await this.dataSource.query(`INSERT INTO fiscal_evento(id_documento,tipo,exito,mensaje,id_user)
        VALUES($1,'CANCELACION_ERROR',false,$2,$3)`, [document.id_documento, message, userId ?? null]);
      throw error;
    }
    const state = result.cancelled ? 'Cancelado' : 'Cancelacion solicitada';
    await this.dataSource.query(`UPDATE fiscal_documento SET estado=$2,acuse_cancelacion=COALESCE($3,acuse_cancelacion),
      fecha_cancelacion=CASE WHEN $4 THEN clock_timestamp() ELSE fecha_cancelacion END,
      motivo_cancelacion=$5,folio_sustitucion=$6,codigo_cancelacion=$7,mensaje_cancelacion=$8,
      updated_at=clock_timestamp() WHERE id_documento=$1`,
    [document.id_documento, state, result.acknowledgement || null, result.cancelled,
      input.reason, input.replacementUuid || null, result.code || null, result.message || null]);
    await this.dataSource.query(`INSERT INTO fiscal_evento(id_documento,tipo,exito,codigo,mensaje,detalle,id_user)
      VALUES($1,'CANCELACION_SOLICITADA',$2,$3,$4,$5::jsonb,$6)`,
    [document.id_documento, result.accepted, result.code || null, result.message || null,
      JSON.stringify({ cancelled: result.cancelled, reason: input.reason }), userId ?? null]);
    return { fiscal: true, cancelled: result.cancelled, state, code: result.code, message: result.message };
  }

  private async reconcile(type: FiscalDocumentType, id: number, input: CancelInput, userId?: number) {
    const document = await this.findDocument(type, id);
    if (!document) throw new NotFoundException('Documento fiscal no encontrado');
    const status = await this.provider.queryStatus(input);
    const cancelled = status.status === 'Cancelado';
    if (cancelled) {
      await this.dataSource.query(`UPDATE fiscal_documento SET estado='Cancelado',fecha_cancelacion=clock_timestamp(),
        updated_at=clock_timestamp() WHERE id_documento=$1`, [document.id_documento]);
    }
    await this.dataSource.query(`INSERT INTO fiscal_evento(id_documento,tipo,exito,codigo,mensaje,detalle,id_user)
      VALUES($1,'ESTADO_CONCILIADO',true,$2,$3,$4::jsonb,$5)`,
    [document.id_documento, status.rawCode || null, status.status,
      JSON.stringify({ cancellableStatus: status.cancellableStatus, cancellationStatus: status.cancellationStatus }), userId ?? null]);
    return { fiscal: true, cancelled, state: cancelled ? 'Cancelado' : 'Cancelacion solicitada', ...status };
  }

  async xml(type: FiscalDocumentType, id: number) {
    const document = await this.findDocument(type, id);
    if (!document?.xml_timbrado) throw new NotFoundException('El documento todavía no tiene XML timbrado');
    return document.xml_timbrado;
  }

  previewXml(type: FiscalDocumentType, id: number) {
    return type === 'FACTURA' ? this.xmlBuilder.buildInvoice(id) : this.xmlBuilder.buildRep(id);
  }

  async acknowledgement(type: FiscalDocumentType, id: number) {
    const document = await this.findDocument(type, id);
    if (!document?.acuse_cancelacion) throw new NotFoundException('El documento todavía no tiene acuse de cancelación');
    return document.acuse_cancelacion;
  }
}
