import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { JwtPayload } from '../auth/auth.types';
import { setAuditActor } from '../auth/audit-actor';
import { RolUsuario } from '../common/enums/app.enums';
import { QueryExecutor, queryRows, readSnapshot } from '../common/database/typed-query';
import { MotivoExpedienteDto } from './unidad-expediente.dto';
import { CrearPiezaDto, PiezasQuery, RevisionPiezaDto, VincularGarantiaPiezaDto } from './unidad-piezas.dto';

const READ = 'crm.unidades.consultar', WRITE = 'crm.unidades.gestionar';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pattern = (term: string) => '%' + term.replace(/[\\%_]/g, '\\$&') + '%';
// Conservative eligibility, matching the existing warranty procedure. Never infer net allocation from ambiguous returns.
const returned = `EXISTS(SELECT 1 FROM devolucion d JOIN devolucion_detalle dd USING(id_devolucion)
 WHERE d.id_factura=f.id_factura AND dd.id_producto=cf.id_producto)
 OR EXISTS(SELECT 1 FROM factura nf JOIN conceptofactura nc ON nc.id_factura=nf.id_factura
 WHERE nf.id_factura_origen=f.id_factura AND nf.estatus::text<>'Cancelada' AND nc.id_producto=cf.id_producto)`;
const originJoins = `FROM conceptofactura cf JOIN factura f ON f.id_factura=cf.id_factura
 LEFT JOIN producto p ON p."IdProducto"=cf.id_producto`;
const originWhere = `WHERE f.id_cliente=$1 AND ($2::int IS NULL OR f.id_unidad IS NULL OR f.id_unidad=$2)
 AND f.estatus::text<>'Cancelada' AND f.tipo_comprobante='I' AND cf.id_producto IS NOT NULL
 AND NOT (${returned}) AND (concat(f.serie,'-',f.folio) ILIKE $3 OR cf.descripcion ILIKE $3 OR p."Codigo" ILIKE $3)`;
interface Unit { id_unidad: number; id_cliente: number | null; vin: string | null; esn: string | null }
interface Piece { id_pieza: number; id_concepto: number; cantidad: string; anulada: boolean; motivo_anulacion: string | null; version: number; compatibilidad: string; referencia: string }
@Injectable()
export class UnidadPiezasService {
 constructor(private readonly source: DataSource) {}
 private async actor(manager: QueryExecutor, actor: JwtPayload, write = false, admin = false) {
  if (admin && actor.role !== RolUsuario.ADMIN) throw new ForbiddenException('Se requiere administrador para esta corrección');
  const [user] = await queryRows<{id: number; nombre: string}>(manager, `SELECT id_user AS id,username AS nombre FROM auth_user
   WHERE id_user=$1 AND is_active AND role=$2 AND token_version=$3
   AND NOT EXISTS(SELECT 1 FROM unnest($4::text[]) code WHERE NOT fn_effective_permission(id_user,role,code)) ${write ? 'FOR SHARE' : ''}`,
   [actor.idUser ?? null, actor.role, actor.version, write ? [READ, WRITE] : [READ]]);
  if (!user) throw new ForbiddenException('Tu cuenta o permiso cambió. Inicia sesión nuevamente.');
  if (write) await setAuditActor(manager, user.id);
  return user;
 }
 private async unit(manager: QueryExecutor, id: number, lock = false) {
  const [unit] = await queryRows<Unit>(manager, `SELECT id_unidad,id_cliente,vin,esn FROM crm_unidad_cliente WHERE id_unidad=$1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
  if (!unit) throw new NotFoundException('Unidad no encontrada');
  return unit;
 }
 private async piece(manager: QueryExecutor, id: number, piece: number) {
  const [row] = await queryRows<Piece>(manager, 'SELECT * FROM crm_unidad_pieza WHERE id_unidad=$1 AND id_pieza=$2', [id, piece]);
  if (!row) throw new NotFoundException('Instalación no encontrada en esta unidad');
  return row;
 }
 private write<T>(id: number, actor: JwtPayload, work: (manager: EntityManager, user: {id: number; nombre: string}, unit: Unit) => Promise<T>, admin = false) {
  return this.source.transaction(async manager => {
   await manager.query("SET LOCAL statement_timeout='5s'");
   const user = await this.actor(manager, actor, true, admin), unit = await this.unit(manager, id, true);
   return work(manager, user, unit);
  });
 }
 private read<T>(id: number, actor: JwtPayload, work: (manager: QueryExecutor, unit: Unit) => Promise<T>) {
  return readSnapshot(this.source, async manager => {
   await manager.query("SET LOCAL statement_timeout='5s'"); await this.actor(manager, actor);
   return work(manager, await this.unit(manager, id));
  });
 }
 private async page(manager: QueryExecutor, select: string, from: string, params: unknown[], query: PiezasQuery, order: string) {
  const [count] = await queryRows<{total: number}>(manager, `SELECT count(*)::int total ${from}`, params);
  const data = await queryRows<Record<string, unknown>>(manager, `SELECT ${select} ${from} ORDER BY ${order} LIMIT 20 OFFSET $${params.length + 1}`, [...params, (query.page - 1) * 20]);
  return {data, total: count.total, page: query.page, limit: 20};
 }
 sources(id: number, query: PiezasQuery, actor: JwtPayload) { return this.read(id, actor, (manager, unit) => this.page(manager,
  `cf.id_concepto AS "idConcepto",f.id_factura AS "idFactura",concat(f.serie,'-',f.folio) AS factura,f.fecha_emision AS "fechaEmision",
   p."Codigo" AS codigo,cf.descripcion,cf.cantidad,
   cf.cantidad-COALESCE((SELECT sum(up.cantidad) FROM crm_unidad_pieza up WHERE up.id_concepto=cf.id_concepto AND NOT up.anulada),0) AS disponible,
   (SELECT count(*)::int FROM producto_aplicacion pa WHERE pa.id_producto=cf.id_producto) AS "aplicacionesTotal",
   COALESCE((SELECT jsonb_agg(a) FROM (SELECT fabricante_equipo,modelo,motor,anio_desde,anio_hasta,restricciones FROM producto_aplicacion pa
    WHERE pa.id_producto=cf.id_producto ORDER BY id_aplicacion LIMIT 5)a),'[]'::jsonb) AS aplicaciones`,
  `${originJoins} ${originWhere}`, [unit.id_cliente, id, pattern(query.term)], query, 'f.fecha_emision DESC,cf.id_concepto DESC'));
 }
 list(id: number, query: PiezasQuery, actor: JwtPayload) { return this.read(id, actor, async manager => {
  const result = await this.page(manager, `up.id_pieza AS "idPieza",up.id_concepto AS "idConcepto",up.cantidad,up.fecha,up.detalle,up.codigo,up.descripcion,up.vin,up.esn,
   up.compatibilidad,up.referencia,up.version,up.autor_nombre AS autor,up.revision_nombre AS "revisadoPor",up.revision_en AS "revisionEn",up.anulada,up.motivo_anulacion AS "motivoAnulacion",
   f.id_factura AS "idFactura",concat(f.serie,'-',f.folio) AS factura,f.estatus::text AS "estadoFactura",f.id_unidad AS "unidadFactura",
   f.id_cliente AS "clienteFactura",(${returned}) AS "conDevoluciones",
   (SELECT count(*)::int FROM crm_unidad_pieza_garantia l WHERE l.id_pieza=up.id_pieza) AS "garantiasTotal",
   COALESCE((SELECT jsonb_agg(a) FROM (SELECT l.id_vinculo AS "idVinculo",l.id_garantia AS "idGarantia",g.estado,g.cantidad,l.motivo,l.autor_nombre AS autor,l.retirado,l.motivo_retiro AS "motivoRetiro"
    FROM crm_unidad_pieza_garantia l JOIN garantia g USING(id_garantia) WHERE l.id_pieza=up.id_pieza ORDER BY l.id_vinculo DESC LIMIT 10)a),'[]'::jsonb) AS garantias`,
   `FROM crm_unidad_pieza up JOIN conceptofactura cf ON cf.id_concepto=up.id_concepto JOIN factura f ON f.id_factura=cf.id_factura
    WHERE up.id_unidad=$1 AND (up.codigo ILIKE $2 OR up.descripcion ILIKE $2 OR concat(f.serie,'-',f.folio) ILIKE $2)`,
   [id, pattern(query.term)], query, 'up.fecha DESC,up.id_pieza DESC');
  return result;
 }); }
 create(id: number, dto: CrearPiezaDto, actor: JwtPayload) {
  const observed = new Date(dto.fecha);
  if (!Number.isFinite(observed.getTime()) || observed.getTime() > Date.now() + 60000) throw new BadRequestException('Indica una fecha válida que no esté en el futuro');
  const fields = {idConcepto: dto.idConcepto, cantidad: dto.cantidad, fecha: observed.toISOString(), detalle: dto.detalle, compatibilidad: dto.compatibilidad, referencia: dto.referencia}, fingerprint = hash(fields);
  return this.write(id, actor, async (manager, user, unit) => {
   const [previous] = await queryRows<{id: number; huella: string}>(manager, 'SELECT id_pieza AS id,huella FROM crm_unidad_pieza WHERE id_unidad=$1 AND request_id=$2', [id, dto.requestId]);
   if (previous) { if (previous.huella !== fingerprint) throw new ConflictException('La clave de instalación ya identifica otros datos'); return {idPieza: previous.id}; }
   if (!unit.id_cliente) throw new ConflictException('Asocia la unidad a un cliente antes de registrar piezas vendidas');
   const [origin] = await queryRows<{codigo: string; descripcion: string; vin: string | null; fecha_valida: boolean; elegible: boolean}>(manager,
    `SELECT COALESCE(p."Codigo",'') AS codigo,cf.descripcion,$4::timestamptz>=f.fecha_emision AS fecha_valida,
     (f.id_cliente=$2 AND (f.id_unidad IS NULL OR f.id_unidad=$3) AND f.estatus::text<>'Cancelada' AND f.tipo_comprobante='I'
      AND cf.id_producto IS NOT NULL AND NOT (${returned})) AS elegible
     ${originJoins} WHERE cf.id_concepto=$1 FOR UPDATE OF cf,f`, [dto.idConcepto, unit.id_cliente, id, fields.fecha]);
   if (!origin) throw new NotFoundException('Renglón de factura no encontrado');
   if (!origin.elegible) throw new ConflictException('El origen debe ser una venta del mismo cliente/unidad, vigente y sin devoluciones o notas por conciliar');
   if (!origin.fecha_valida) throw new ConflictException('La instalación no puede ser anterior a la venta de origen');
   const [allocation] = await queryRows<{excede: boolean}>(manager, `SELECT COALESCE((SELECT sum(cantidad) FROM crm_unidad_pieza WHERE id_concepto=$1 AND NOT anulada),0)+$2::numeric>cantidad AS excede
     FROM conceptofactura WHERE id_concepto=$1`, [dto.idConcepto, dto.cantidad]);
   if (allocation.excede) throw new ConflictException('La cantidad instalada entre todas las unidades excedería la cantidad vendida');
   const [row] = await queryRows<{idPieza: number}>(manager, `INSERT INTO crm_unidad_pieza(id_unidad,id_concepto,request_id,huella,cantidad,fecha,detalle,codigo,descripcion,vin,esn,compatibilidad,referencia,id_autor,autor_nombre,revision_nombre)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15) RETURNING id_pieza AS "idPieza"`,
    [id, dto.idConcepto, dto.requestId, fingerprint, dto.cantidad, fields.fecha, dto.detalle, origin.codigo, origin.descripcion, unit.vin, unit.esn, dto.compatibilidad, dto.referencia, user.id, user.nombre]);
   return row;
  });
 }
 review(id: number, piece: number, dto: RevisionPiezaDto, actor: JwtPayload) { return this.write(id, actor, async (manager, user) => {
  const row = await this.piece(manager, id, piece);
  if (row.anulada) throw new ConflictException('La instalación está anulada');
  if (row.compatibilidad === dto.compatibilidad && row.referencia === dto.referencia && (row.version === dto.version || row.version === dto.version + 1)) return {version: row.version};
  if (row.version !== dto.version) throw new ConflictException('La revisión cambió; actualiza el expediente');
  const [updated] = await queryRows<{version: number}>(manager, `UPDATE crm_unidad_pieza SET compatibilidad=$2,referencia=$3,version=version+1,revision_nombre=$4,revision_en=now() WHERE id_pieza=$1 RETURNING version`, [piece, dto.compatibilidad, dto.referencia, user.nombre]);
  return updated;
 }); }
 annul(id: number, piece: number, dto: MotivoExpedienteDto, actor: JwtPayload) { return this.write(id, actor, async manager => {
  const row = await this.piece(manager, id, piece);
  if (row.anulada) { if (row.motivo_anulacion !== dto.motivo) throw new ConflictException('La instalación ya fue anulada con otro motivo'); return {message: 'Instalación anulada'}; }
  const [claims] = await queryRows<{present: boolean}>(manager, 'SELECT EXISTS(SELECT 1 FROM crm_unidad_pieza_garantia WHERE id_pieza=$1 AND NOT retirado) AS present', [piece]);
  if (claims.present) throw new ConflictException('Retira primero los vínculos incorrectos de garantía antes de anular la instalación');
  await manager.query('UPDATE crm_unidad_pieza SET anulada=true,motivo_anulacion=$2,version=version+1 WHERE id_pieza=$1', [piece, dto.motivo]);
  return {message: 'Instalación anulada'};
 }, true); }
 claims(id: number, piece: number, query: PiezasQuery, actor: JwtPayload) { return this.read(id, actor, async (manager, unit) => {
  const row = await this.piece(manager, id, piece);
  return this.page(manager, `g.id_garantia AS "idGarantia",g.estado,g.motivo,g.cantidad`,
   `FROM garantia g JOIN conceptofactura cf ON cf.id_concepto=g.id_concepto JOIN factura f ON f.id_factura=g.id_factura
    WHERE g.id_concepto=$1 AND cf.id_factura=g.id_factura AND f.id_cliente=$2 AND (f.id_unidad IS NULL OR f.id_unidad=$3)
     AND NOT $4 AND g.cantidad<=$5::numeric AND NOT EXISTS(SELECT 1 FROM crm_unidad_pieza_garantia l WHERE l.id_garantia=g.id_garantia AND NOT l.retirado)
     AND (g.id_garantia::text=$6 OR g.motivo ILIKE $7)`, [row.id_concepto, unit.id_cliente, id, row.anulada, row.cantidad, query.term, pattern(query.term)], query, 'g.id_garantia DESC');
 }); }
 link(id: number, piece: number, dto: VincularGarantiaPiezaDto, actor: JwtPayload) { return this.write(id, actor, async (manager, user, unit) => {
  const row = await this.piece(manager, id, piece), fingerprint = hash({idGarantia: dto.idGarantia, motivo: dto.motivo});
  const [previous] = await queryRows<{id: number; huella: string}>(manager, 'SELECT id_vinculo AS id,huella FROM crm_unidad_pieza_garantia WHERE id_pieza=$1 AND request_id=$2', [piece, dto.requestId]);
  if (previous) { if (previous.huella !== fingerprint) throw new ConflictException('La clave del vínculo ya identifica otros datos'); return {idVinculo: previous.id}; }
  if (row.anulada) throw new ConflictException('La instalación está anulada');
  const [claim] = await queryRows<{valida: boolean}>(manager, `SELECT (g.id_concepto=$2 AND cf.id_factura=g.id_factura AND f.id_cliente=$3
    AND (f.id_unidad IS NULL OR f.id_unidad=$4) AND g.cantidad<=$5::numeric) AS valida
    FROM garantia g JOIN conceptofactura cf ON cf.id_concepto=g.id_concepto JOIN factura f ON f.id_factura=g.id_factura
    WHERE g.id_garantia=$1 FOR UPDATE OF g FOR SHARE OF cf,f`, [dto.idGarantia, row.id_concepto, unit.id_cliente, id, row.cantidad]);
  if (!claim) throw new NotFoundException('Garantía no encontrada');
  if (!claim.valida) throw new ConflictException('La garantía debe corresponder a la misma venta, cliente/unidad y cantidad instalada');
  const [active] = await queryRows(manager, 'SELECT id_vinculo FROM crm_unidad_pieza_garantia WHERE id_garantia=$1 AND NOT retirado', [dto.idGarantia]);
  if (active) throw new ConflictException('La garantía ya tiene una instalación vinculada');
  const [linked] = await queryRows<{idVinculo: number}>(manager, `INSERT INTO crm_unidad_pieza_garantia(id_pieza,id_garantia,request_id,huella,motivo,id_autor,autor_nombre)
   VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id_vinculo AS "idVinculo"`, [piece, dto.idGarantia, dto.requestId, fingerprint, dto.motivo, user.id, user.nombre]);
  return linked;
 }); }
 history(id: number, piece: number, query: PiezasQuery, actor: JwtPayload) { return this.read(id, actor, async manager => {
  await this.piece(manager, id, piece);
  return this.page(manager, `l.id_vinculo AS "idVinculo",l.id_garantia AS "idGarantia",g.estado,g.cantidad,l.motivo,l.autor_nombre AS autor,l.retirado,l.motivo_retiro AS "motivoRetiro"`,
   `FROM crm_unidad_pieza_garantia l JOIN garantia g USING(id_garantia) WHERE l.id_pieza=$1`, [piece], query, 'l.id_vinculo DESC');
 }); }
 unlink(id: number, piece: number, link: number, dto: MotivoExpedienteDto, actor: JwtPayload) { return this.write(id, actor, async manager => {
  await this.piece(manager, id, piece);
  const [row] = await queryRows<{retirado: boolean; motivo_retiro: string | null}>(manager, 'SELECT retirado,motivo_retiro FROM crm_unidad_pieza_garantia WHERE id_pieza=$1 AND id_vinculo=$2', [piece, link]);
  if (!row) throw new NotFoundException('Vínculo no encontrado en esta instalación');
  if (row.retirado) { if (row.motivo_retiro !== dto.motivo) throw new ConflictException('El vínculo ya fue retirado con otro motivo'); return {message: 'Vínculo retirado'}; }
  await manager.query('UPDATE crm_unidad_pieza_garantia SET retirado=true,motivo_retiro=$2 WHERE id_vinculo=$1', [link, dto.motivo]);
  return {message: 'Vínculo retirado'};
 }, true); }
}
