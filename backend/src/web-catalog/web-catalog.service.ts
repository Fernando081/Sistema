import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UPLOAD_DIRECTORY } from '../upload/upload-path';
import { exportWebCandidate } from './web-catalog-export';
import { createHash } from 'node:crypto';
import { validateBatch, matchesBatchProduct } from './web-catalog-batch';
import {
  QueryExecutor,
  queryRows,
  readSnapshot,
} from '../common/database/typed-query';
import {
  SaveWebProductDto,
  WebSpecificationDto,
  WebCatalogListDto,
} from './web-catalog.dto';

interface ProductSource {
  equivalencias: {
    id: number;
    codigo: string | null;
    nombre: string;
    marca: string | null;
  }[];
  codigo: string | null;
  nombre: string;
  marca: string | null;
  imagenes: unknown;
  categoria: string | null;
  numerosParte: { tipo: string; fabricante: string | null; numero: string }[];
  aplicaciones: {
    fabricante: string | null;
    modelo: string | null;
    motor: string | null;
    desde: number | null;
    hasta: number | null;
    restricciones: string | null;
  }[];
}
export interface WebProfile {
  version: number;
  estado: 'borrador' | 'listo' | 'retirado';
  slug: string;
  titulo: string;
  descripcion: string;
  datosRealesConfirmados: boolean;
  derechosImagenConfirmados: boolean;
  compatibilidadVerificada: boolean;
  updatedAt: string;
  snapshot: unknown;
}
const PROFILE_FIELDS = `version,estado,slug,titulo,descripcion,
  datos_reales_confirmados AS "datosRealesConfirmados",
  derechos_imagen_confirmados AS "derechosImagenConfirmados",
  compatibilidad_verificada AS "compatibilidadVerificada",updated_at AS "updatedAt",snapshot`;
export function webImagePaths(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return [
    ...new Set(
      images
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.replace(/^\/uploads\//, ''))
        .filter((value) =>
          /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(png|jpe?g|webp)$/i.test(value),
        ),
    ),
  ]
    .slice(0, 12)
    .map((value) => '/uploads/' + value);
}

@Injectable()
export class WebCatalogService {
  constructor(@InjectDataSource() private readonly source: DataSource) {}
  async batchStatus(receipt: number) {
    return readSnapshot(this.source, async (source) => {
      const [event] = await queryRows<{
        new_record: {
          sha256: string;
          members: { productId: number; version: number; baseHash: string }[];
        };
        revoked: boolean;
      }>(
        source,
        `SELECT a.new_record,EXISTS(SELECT 1 FROM auditoria_jsonb r WHERE r.table_name='web_catalog_batch_approval' AND r.action='REVOKE' AND r.new_record->>'receiptId'=a.id::text) revoked FROM auditoria_jsonb a WHERE a.id=$1 AND a.table_name='web_catalog_batch_approval' AND a.action='APPROVE'`,
        [receipt],
      );
      if (!event) throw new NotFoundException('Recibo de lote no encontrado');
      const members = event.new_record.members;
      let active =
        !event.revoked &&
        Array.isArray(members) &&
        members.length > 0 &&
        members.length <= 25;
      if (active)
        for (const member of members) {
          const [profile] = await queryRows<WebProfile>(
            source,
            `SELECT ${PROFILE_FIELDS} FROM web_producto_ficha WHERE id_producto=$1`,
            [member.productId],
          );
          if (
            !profile ||
            profile.version !== member.version ||
            profile.estado !== 'listo' ||
            !profile.datosRealesConfirmados ||
            !profile.derechosImagenConfirmados ||
            !profile.compatibilidadVerificada
          ) {
            active = false;
            break;
          }
          try {
            if (
              createHash('sha256')
                .update(
                  JSON.stringify(
                    exportWebCandidate(profile.slug, profile.snapshot),
                  ),
                )
                .digest('hex') !== member.baseHash
            ) {
              active = false;
              break;
            }
          } catch {
            active = false;
            break;
          }
        }
      return {
        scope: 'batch',
        receiptId: receipt,
        sha256: event.new_record.sha256,
        revoked: event.revoked,
        active,
        productCount: Array.isArray(members) ? members.length : 0,
      };
    });
  }
  async revokeBatch(receipt: number, confirmed: boolean, userId: number) {
    if (confirmed !== true || !Number.isSafeInteger(userId) || userId < 1)
      throw new BadRequestException('Confirma la revocación del lote');
    return this.source.transaction(async (manager) => {
      const rows = await queryRows<{ id: number }>(
        manager,
        `SELECT id FROM auditoria_jsonb WHERE id=$1 AND table_name='web_catalog_batch_approval' AND action='APPROVE' FOR UPDATE`,
        [receipt],
      );
      if (!rows.length)
        throw new NotFoundException('Recibo de lote no encontrado');
      const previous = await queryRows<{ id: number }>(
        manager,
        `SELECT id FROM auditoria_jsonb WHERE table_name='web_catalog_batch_approval' AND action='REVOKE' AND new_record->>'receiptId'=$1`,
        [String(receipt)],
      );
      if (!previous.length)
        await manager.query(
          `INSERT INTO auditoria_jsonb(table_name,action,new_record,app_user_id) VALUES ('web_catalog_batch_approval','REVOKE',$1::jsonb,$2)`,
          [JSON.stringify({ receiptId: receipt }), userId],
        );
      return {
        receiptId: receipt,
        revoked: true,
        scope: 'No retira versiones activas automáticamente',
      };
    });
  }
  async approveBatch(
    raw: string,
    members: { productId: number; version: number }[],
    confirmed: boolean,
    userId: number,
  ) {
    if (!confirmed || !Number.isSafeInteger(userId) || userId < 1)
      throw new BadRequestException(
        'Confirma el lote con una cuenta persistida',
      );
    const products = validateBatch(raw);
    if (
      members.length !== products.length ||
      new Set(members.map((item) => item.productId)).size !== members.length
    )
      throw new BadRequestException('Selecciona una versión por producto');
    return this.source.transaction(async (manager) => {
      const selected = [];
      for (const member of [...members].sort(
        (a, b) => a.productId - b.productId,
      )) {
        const [profile] = await queryRows<WebProfile>(
          manager,
          `SELECT ${PROFILE_FIELDS} FROM web_producto_ficha WHERE id_producto=$1 FOR UPDATE`,
          [member.productId],
        );
        if (!profile) throw new NotFoundException('Ficha no encontrada');
        if (profile.version !== member.version)
          throw new ConflictException('Una ficha del lote cambió');
        if (
          profile.estado !== 'listo' ||
          !profile.datosRealesConfirmados ||
          !profile.derechosImagenConfirmados ||
          !profile.compatibilidadVerificada
        )
          throw new BadRequestException(
            'Todas las fichas deben estar listas y confirmadas',
          );
        const product = products.find((item) => item.slug === profile.slug);
        if (!product)
          throw new BadRequestException('El producto no corresponde al lote');
        matchesBatchProduct(product, profile.slug, profile.snapshot);
        const baseHash = createHash('sha256')
          .update(
            JSON.stringify(exportWebCandidate(profile.slug, profile.snapshot)),
          )
          .digest('hex');
        selected.push({ ...member, baseHash });
      }
      const sha256 = createHash('sha256').update(raw).digest('hex');
      const [receipt] = await queryRows<{ id: number; timestamp: string }>(
        manager,
        `INSERT INTO auditoria_jsonb(table_name,action,new_record,app_user_id) VALUES ('web_catalog_batch_approval','APPROVE',$1::jsonb,$2) RETURNING id,timestamp`,
        [JSON.stringify({ sha256, members: selected }), userId],
      );
      return {
        raw,
        sha256,
        receipt,
        scope:
          'Lote aprobado; no activa sitio. Fotografías y compatibilidad requieren evidencia editorial real.',
      };
    });
  }

  async list(dto: WebCatalogListDto) {
    return readSnapshot(this.source, async (source) => {
      const base = `WITH masters AS (SELECT p."IdProducto" id,p."Codigo" codigo,p."Descripcion" nombre,p."Marca" marca,
        c."Descripcion" categoria,
        CASE WHEN nullif(trim(p."Codigo"),'') IS NULL THEN 0 ELSE count(*) OVER (PARTITION BY regexp_replace(lower(p."Codigo"),'[^a-z0-9]','','g'),lower(trim(coalesce(p."Marca",'')))) END AS duplicados
        FROM producto p LEFT JOIN categoria c ON c."IdCategoria"=p."IdCategoria"),
        catalog AS (SELECT m.*,coalesce(f.estado,'sin_ficha') estado,f.slug,f.version,f.updated_at AS "updatedAt",
        array_remove(ARRAY[
          CASE WHEN f.id_producto IS NULL THEN 'Preparar ficha comercial' END,
          CASE WHEN nullif(trim(m.codigo),'') IS NULL THEN 'Código faltante' END,
          CASE WHEN nullif(trim(m.marca),'') IS NULL THEN 'Marca faltante' END,
          CASE WHEN nullif(trim(m.categoria),'') IS NULL THEN 'Categoría faltante' END,
          CASE WHEN coalesce(jsonb_array_length(f.snapshot->'imagenes'),0)=0 THEN 'Seleccionar fotografías' END,
          CASE WHEN coalesce(jsonb_array_length(f.snapshot->'especificaciones'),0)=0 THEN 'Revisar especificaciones' END,
          CASE WHEN NOT coalesce(f.datos_reales_confirmados,false) THEN 'Confirmar datos reales' END,
          CASE WHEN NOT coalesce(f.derechos_imagen_confirmados,false) THEN 'Confirmar derechos de imágenes' END,
          CASE WHEN NOT coalesce(f.compatibilidad_verificada,false) THEN 'Confirmar compatibilidad' END,
          CASE WHEN nullif(trim(f.snapshot->>'fuenteCompatibilidad'),'') IS NULL THEN 'Registrar fuente de compatibilidad' END,
          CASE WHEN (coalesce(jsonb_array_length(f.snapshot->'numerosParte'),0)>0 OR coalesce(jsonb_array_length(f.snapshot->'equivalencias'),0)>0) AND nullif(trim(f.snapshot->>'fuenteReferencias'),'') IS NULL THEN 'Registrar fuente de referencias' END,
          CASE WHEN m.duplicados>1 THEN 'Revisar posible código duplicado en la marca' END,
          CASE WHEN f.id_producto IS NOT NULL AND (f.snapshot->>'codigo' IS DISTINCT FROM m.codigo OR f.snapshot->>'marca' IS DISTINCT FROM m.marca OR f.snapshot->>'categoria' IS DISTINCT FROM m.categoria) THEN 'Revisar cambios del maestro' END
        ],NULL) pendientes FROM masters m LEFT JOIN web_producto_ficha f ON f.id_producto=m.id)
        SELECT * FROM catalog WHERE ($1='todos' OR estado=$1) AND ($2='' OR strpos(lower(coalesce(codigo,'')||' '||coalesce(nombre,'')||' '||coalesce(marca,'')||' '||coalesce(categoria,'')),lower($2))>0)
        AND ($3='todos' OR ($3='con_pendientes' AND cardinality(pendientes)>0) OR ($3='sin_pendientes' AND cardinality(pendientes)=0))`;
      const args = [dto.estado, dto.term.trim(), dto.revision ?? 'todos'];
      const [count] = await queryRows<{ total: number }>(
        source,
        `SELECT count(*)::int total FROM (${base}) filtered`,
        args,
      );
      const data = await queryRows<{
        id: number;
        codigo: string | null;
        nombre: string;
        marca: string | null;
        categoria: string | null;
        estado: string;
        slug: string | null;
        version: number | null;
        updatedAt: string | null;
        duplicados: string;
        pendientes: string[];
      }>(source, `${base} ORDER BY id LIMIT $4 OFFSET $5`, [
        ...args,
        dto.limit,
        (dto.page - 1) * dto.limit,
      ]);
      return { data, total: count.total, page: dto.page, limit: dto.limit };
    });
  }

  private async product(source: QueryExecutor, id: number, lock = false) {
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new BadRequestException('Producto inválido');
    const [row] = await queryRows<ProductSource>(
      source,
      `SELECT
      p."Codigo" AS codigo,p."Descripcion" AS nombre,p."Marca" AS marca,p.imagenes,c."Descripcion" AS categoria,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',ep."IdProducto",'codigo',ep."Codigo",'nombre',ep."Descripcion",'marca',ep."Marca") ORDER BY ep."IdProducto")
        FROM producto_equivalente pe JOIN producto ep ON ep."IdProducto"=pe."IdProductoEquivalente" WHERE pe."IdProducto"=p."IdProducto"),'[]'::jsonb) AS equivalencias,
      coalesce((SELECT jsonb_agg(jsonb_build_object('tipo',tipo,'fabricante',fabricante,'numero',numero) ORDER BY id_numero)
        FROM producto_numero_parte WHERE id_producto=p."IdProducto"),'[]'::jsonb) AS "numerosParte",
      coalesce((SELECT jsonb_agg(jsonb_build_object('fabricante',fabricante_equipo,'modelo',modelo,'motor',motor,
        'desde',anio_desde,'hasta',anio_hasta,'restricciones',restricciones) ORDER BY id_aplicacion)
        FROM producto_aplicacion WHERE id_producto=p."IdProducto"),'[]'::jsonb) AS aplicaciones
      FROM producto p LEFT JOIN categoria c ON c."IdCategoria"=p."IdCategoria" WHERE p."IdProducto"=$1 ${lock ? 'FOR UPDATE OF p' : ''}`,
      [id],
    );
    if (!row) throw new NotFoundException('Producto no encontrado');
    return {
      codigo: row.codigo,
      nombre: row.nombre,
      marca: row.marca,
      categoria: row.categoria,
      imagenes: webImagePaths(row.imagenes),
      numerosParte: row.numerosParte,
      aplicaciones: row.aplicaciones,
      equivalencias: row.equivalencias ?? [],
    };
  }

  async preview(id: number) {
    return readSnapshot(this.source, async (source) => ({
      producto: await this.product(source, id),
      ficha:
        (
          await queryRows<WebProfile>(
            source,
            `SELECT ${PROFILE_FIELDS} FROM web_producto_ficha WHERE id_producto=$1`,
            [id],
          )
        )[0] ?? null,
      alcance:
        'Vista administrativa de preparación; no hay publicación pública activa',
    }));
  }

  async exportCandidate(id: number) {
    return readSnapshot(this.source, async (source) => {
      const [profile] = await queryRows<WebProfile>(
        source,
        `SELECT ${PROFILE_FIELDS} FROM web_producto_ficha WHERE id_producto=$1`,
        [id],
      );
      if (!profile) throw new NotFoundException('Ficha no encontrada');
      if (
        profile.estado !== 'listo' ||
        !profile.datosRealesConfirmados ||
        !profile.derechosImagenConfirmados ||
        !profile.compatibilidadVerificada
      )
        throw new BadRequestException(
          'Solo se exportan candidatas listas y confirmadas',
        );
      return exportWebCandidate(profile.slug, profile.snapshot);
    });
  }
  async approveCandidate(
    id: number,
    version: number,
    confirmed: boolean,
    userId: number,
  ) {
    if (confirmed !== true || !Number.isSafeInteger(userId) || userId < 1)
      throw new BadRequestException(
        'Confirma la revisión con una cuenta persistida',
      );
    return this.source.transaction(async (manager) => {
      const [profile] = await queryRows<WebProfile>(
        manager,
        `SELECT ${PROFILE_FIELDS} FROM web_producto_ficha WHERE id_producto=$1 FOR UPDATE`,
        [id],
      );
      if (!profile) throw new NotFoundException('Ficha no encontrada');
      if (profile.version !== version)
        throw new ConflictException('La ficha cambió; vuelve a revisarla');
      if (
        profile.estado !== 'listo' ||
        !profile.datosRealesConfirmados ||
        !profile.derechosImagenConfirmados ||
        !profile.compatibilidadVerificada
      )
        throw new BadRequestException('La ficha no está lista y confirmada');
      const manifest = exportWebCandidate(profile.slug, profile.snapshot);
      const publication = {
        schemaVersion: 1,
        products: manifest.products.map((item) => ({
          ...item,
          status: 'published',
          approved: true,
        })),
      };
      const raw = JSON.stringify(publication, null, 2);
      const sha256 = createHash('sha256').update(raw).digest('hex');
      const [receipt] = await queryRows<{ id: number; timestamp: string }>(
        manager,
        `INSERT INTO auditoria_jsonb (table_name,action,new_record,app_user_id) VALUES ('web_catalog_approval','APPROVE',$1::jsonb,$2) RETURNING id,timestamp`,
        [
          JSON.stringify({
            productId: id,
            version,
            sha256,
            slug: profile.slug,
          }),
          userId,
        ],
      );
      return {
        raw,
        sha256,
        receipt,
        scope:
          'Aprobación editorial registrada; no activa ni despliega el sitio',
      };
    });
  }
  async approvalStatus(id: number, receipt: number) {
    return readSnapshot(this.source, async (source) => {
      const [event] = await queryRows<{
        version: number;
        sha256: string;
        revoked: boolean;
      }>(
        source,
        `SELECT (a.new_record->>'version')::int version,a.new_record->>'sha256' sha256,EXISTS(SELECT 1 FROM auditoria_jsonb r WHERE r.table_name='web_catalog_approval' AND r.action='REVOKE' AND r.new_record->>'receiptId'=a.id::text) revoked FROM auditoria_jsonb a WHERE a.id=$1 AND a.table_name='web_catalog_approval' AND a.action='APPROVE' AND a.new_record->>'productId'=$2`,
        [receipt, String(id)],
      );
      if (!event)
        throw new NotFoundException('Recibo no encontrado para esta ficha');
      const [profile] = await queryRows<WebProfile>(
        source,
        `SELECT ${PROFILE_FIELDS} FROM web_producto_ficha WHERE id_producto=$1`,
        [id],
      );
      let active =
        !!profile &&
        !event.revoked &&
        profile.version === event.version &&
        profile.estado === 'listo' &&
        profile.datosRealesConfirmados &&
        profile.derechosImagenConfirmados &&
        profile.compatibilidadVerificada;
      if (active) {
        try {
          const candidate = exportWebCandidate(profile.slug, profile.snapshot);
          const raw = JSON.stringify(
            {
              schemaVersion: 1,
              products: candidate.products.map((item) => ({
                ...item,
                status: 'published',
                approved: true,
              })),
            },
            null,
            2,
          );
          active =
            createHash('sha256').update(raw).digest('hex') === event.sha256;
        } catch {
          active = false;
        }
      }
      return {
        receiptId: receipt,
        productId: id,
        version: event.version,
        sha256: event.sha256,
        revoked: event.revoked,
        active,
      };
    });
  }
  async revokeApproval(
    id: number,
    receipt: number,
    confirmed: boolean,
    userId: number,
  ) {
    if (confirmed !== true || !Number.isSafeInteger(userId) || userId < 1)
      throw new BadRequestException(
        'Confirma la revocación con cuenta persistida',
      );
    return this.source.transaction(async (manager) => {
      const rows = await queryRows<{ id_producto: number }>(
        manager,
        'SELECT id_producto FROM web_producto_ficha WHERE id_producto=$1 FOR UPDATE',
        [id],
      );
      if (!rows.length) throw new NotFoundException('Ficha no encontrada');
      const events = await queryRows<{ id: number }>(
        manager,
        `SELECT id FROM auditoria_jsonb WHERE id=$1 AND table_name='web_catalog_approval' AND action='APPROVE' AND new_record->>'productId'=$2`,
        [receipt, String(id)],
      );
      if (!events.length)
        throw new NotFoundException('Recibo no encontrado para esta ficha');
      const previous = await queryRows<{ id: number }>(
        manager,
        `SELECT id FROM auditoria_jsonb WHERE table_name='web_catalog_approval' AND action='REVOKE' AND new_record->>'receiptId'=$1`,
        [String(receipt)],
      );
      if (!previous.length)
        await manager.query(
          `INSERT INTO auditoria_jsonb(table_name,action,new_record,app_user_id) VALUES ('web_catalog_approval','REVOKE',$1::jsonb,$2)`,
          [JSON.stringify({ receiptId: receipt, productId: id }), userId],
        );
      return {
        receiptId: receipt,
        revoked: true,
        scope: 'No retira automáticamente versiones ya activadas',
      };
    });
  }

  async save(id: number, dto: SaveWebProductDto, userId: number) {
    if (!Number.isSafeInteger(userId) || userId <= 0)
      throw new BadRequestException(
        'Se requiere cuenta administrativa persistida',
      );
    try {
      return await this.source.transaction(async (manager) => {
        const product = await this.product(manager, id, true);
        const [previous] = await queryRows<{
          version: number;
          snapshot: {
            fuenteCompatibilidad?: string;
            fuenteReferencias?: string;
            imagenes?: string[];
            especificaciones?: WebSpecificationDto[];
            equivalencias?: { id: number }[];
          };
        }>(
          manager,
          'SELECT version,snapshot FROM web_producto_ficha WHERE id_producto=$1',
          [id],
        );
        if ((previous?.version ?? 0) !== dto.version)
          throw new ConflictException('La ficha cambió; vuelve a cargarla');
        const images =
          dto.imagenes ?? previous?.snapshot?.imagenes ?? product.imagenes;
        if (images.some((image) => !product.imagenes.includes(image)))
          throw new BadRequestException(
            'Selecciona solo imágenes actuales de este producto',
          );
        const specifications =
          dto.especificaciones ?? previous?.snapshot?.especificaciones ?? [];
        const equivalentIds =
          dto.equivalencias ??
          previous?.snapshot?.equivalencias?.map((item) => item.id) ??
          [];
        if (
          equivalentIds.some(
            (id) => !product.equivalencias.some((item) => item.id === id),
          )
        )
          throw new BadRequestException(
            'Selecciona solo equivalencias vinculadas actualmente al producto',
          );
        if (
          new Set(
            specifications.map((item) =>
              item.nombre.trim().toLocaleLowerCase('es'),
            ),
          ).size !== specifications.length
        )
          throw new BadRequestException(
            'No repitas nombres de especificaciones',
          );
        if (
          dto.estado === 'listo' &&
          (!dto.datosRealesConfirmados ||
            !dto.derechosImagenConfirmados ||
            !dto.compatibilidadVerificada ||
            !product.codigo?.trim() ||
            !product.marca?.trim() ||
            images.length === 0 ||
            !images.every((image) =>
              existsSync(
                join(UPLOAD_DIRECTORY, image.slice('/uploads/'.length)),
              ),
            ))
        )
          throw new BadRequestException(
            'Para marcar lista confirma datos reales, derechos y compatibilidad; completa código, marca y al menos una imagen local existente',
          );
        const snapshot = {
          codigo: product.codigo,
          marca: product.marca,
          categoria: product.categoria,
          equivalencias: equivalentIds.map((id) =>
            product.equivalencias.find((item) => item.id === id)!,
          ),
          fuenteCompatibilidad:
            dto.fuenteCompatibilidad?.trim() ??
            previous?.snapshot?.fuenteCompatibilidad ??
            null,
          fuenteReferencias:
            dto.fuenteReferencias?.trim() ??
            previous?.snapshot?.fuenteReferencias ??
            null,
          titulo: dto.titulo.trim(),
          descripcion: dto.descripcion.trim(),
          imagenes: images,
          especificaciones: specifications.map(({ nombre, valor, unidad }) => ({
            nombre: nombre.trim(),
            valor: valor.trim(),
            unidad: unidad.trim(),
          })),
          numerosParte: product.numerosParte,
          aplicaciones: product.aplicaciones,
        };
        const [row] = await queryRows<WebProfile>(
          manager,
          `INSERT INTO web_producto_ficha
          (id_producto,slug,titulo,descripcion,estado,datos_reales_confirmados,derechos_imagen_confirmados,compatibilidad_verificada,snapshot,updated_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
          ON CONFLICT(id_producto) DO UPDATE SET slug=excluded.slug,titulo=excluded.titulo,descripcion=excluded.descripcion,
          estado=excluded.estado,datos_reales_confirmados=excluded.datos_reales_confirmados,
          derechos_imagen_confirmados=excluded.derechos_imagen_confirmados,compatibilidad_verificada=excluded.compatibilidad_verificada,
          snapshot=excluded.snapshot,version=web_producto_ficha.version+1,updated_by=excluded.updated_by,updated_at=clock_timestamp()
          RETURNING ${PROFILE_FIELDS}`,
          [
            id,
            dto.slug,
            dto.titulo.trim(),
            dto.descripcion.trim(),
            dto.estado,
            dto.datosRealesConfirmados,
            dto.derechosImagenConfirmados,
            dto.compatibilidadVerificada,
            JSON.stringify(snapshot),
            userId,
          ],
        );
        return row;
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '23505'
      )
        throw new ConflictException('La dirección ya pertenece a otra ficha');
      throw error;
    }
  }
}
