import { BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException,ServiceUnavailableException } from '@nestjs/common';
import { DataSource,EntityManager } from 'typeorm';
import { createHash } from 'node:crypto';
import { JwtPayload } from '../auth/auth.types';
import { RolUsuario } from '../common/enums/app.enums';
import { setAuditActor } from '../auth/audit-actor';
import { QueryExecutor,queryRows,readSnapshot } from '../common/database/typed-query';
import { imageExtension } from '../upload/image-validation';
import { ArchivoUnidadDto,CerrarMantenimientoDto,ExpedienteQuery,LecturaUnidadDto,MantenimientoUnidadDto,MotivoExpedienteDto } from './unidad-expediente.dto';

const READ='crm.unidades.consultar',WRITE='crm.unidades.gestionar';
const fingerprint=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const meters=`SELECT
 (SELECT kilometraje FROM crm_unidad_lectura WHERE id_unidad=$1 AND NOT anulada AND kilometraje IS NOT NULL ORDER BY fecha DESC,id_lectura DESC LIMIT 1) AS km,
 (SELECT horas FROM crm_unidad_lectura WHERE id_unidad=$1 AND NOT anulada AND horas IS NOT NULL ORDER BY fecha DESC,id_lectura DESC LIMIT 1) AS horas`;
@Injectable()
export class UnidadExpedienteService{
 constructor(private readonly source:DataSource){}
 private async actor(manager:QueryExecutor,actor:JwtPayload,write=false,admin=false){
  if(admin&&actor.role!==RolUsuario.ADMIN)throw new ForbiddenException('Se requiere administrador para anular o retirar evidencia');
  const required=write?[READ,WRITE]:[READ];
  const [user]=await queryRows<{id:number;nombre:string}>(manager,`SELECT id_user AS id,username AS nombre FROM auth_user
   WHERE id_user=$1 AND is_active AND role=$2 AND token_version=$3
   AND NOT EXISTS(SELECT 1 FROM unnest($4::text[]) code WHERE NOT fn_effective_permission(id_user,role,code))
   ${write?'FOR SHARE':''}`,[actor.idUser??null,actor.role,actor.version,required]);
  if(!user)throw new ForbiddenException('Tu cuenta o permiso del expediente cambió. Inicia sesión nuevamente.');
  if(write)await setAuditActor(manager,user.id);return user;
 }
 private async unit(manager:QueryExecutor,id:number,lock=false){
  const [row]=await queryRows<Record<string,unknown>>(manager,`SELECT id_unidad AS "idUnidad",id_cliente AS "idCliente",id_oportunidad AS "idOportunidad",
    vin,esn,numero_economico AS "numeroEconomico",marca,modelo,anio,motor,transmision,diferencial,placas,notas
    FROM crm_unidad_cliente WHERE id_unidad=$1 ${lock?'FOR UPDATE':''}`,[id]);
  if(!row)throw new NotFoundException('Unidad no encontrada');return row;
 }
 private transaction<T>(id:number,actor:JwtPayload,work:(manager:EntityManager,user:{id:number;nombre:string})=>Promise<T>,admin=false){
  return this.source.transaction(async manager=>{await manager.query("SET LOCAL statement_timeout='5s'");
   const user=await this.actor(manager,actor,true,admin);await this.unit(manager,id,true);return work(manager,user);});
 }
 private date(value:string){const date=new Date(value);if(!Number.isFinite(date.getTime())||date.getTime()>Date.now()+60000)
  throw new BadRequestException('Indica una fecha válida que no esté en el futuro');return date.toISOString();}
 async expediente(id:number,query:ExpedienteQuery,actor:JwtPayload){
  return readSnapshot(this.source,async manager=>{
   await manager.query("SET LOCAL statement_timeout='5s'");await this.actor(manager,actor);
   const unidad=await this.unit(manager,id),[actual]=await queryRows<{km:string|null;horas:string|null}>(manager,meters,[id]);
   const lecturas=await queryRows(manager,`SELECT id_lectura AS "idLectura",fecha,kilometraje,horas,notas,autor_nombre AS autor,anulada,motivo_anulacion AS "motivoAnulacion"
     FROM crm_unidad_lectura WHERE id_unidad=$1 ORDER BY fecha DESC,id_lectura DESC LIMIT 20 OFFSET $2`,[id,(query.lecturasPage-1)*20]);
   const [lecturasCount]=await queryRows<{total:number}>(manager,'SELECT count(*)::int total FROM crm_unidad_lectura WHERE id_unidad=$1',[id]);
   const mantenimientos=await queryRows(manager,`WITH meters AS (${meters}) SELECT p.id_mantenimiento AS "idMantenimiento",p.titulo,p.notas,p.fecha_objetivo::text AS "fechaObjetivo",
     p.kilometraje_objetivo AS "kilometrajeObjetivo",p.horas_objetivo AS "horasObjetivo",p.estado,p.version,p.fecha_realizada AS "fechaRealizada",p.detalle_cierre AS "detalleCierre",p.autor_nombre AS autor,p.cierre_nombre AS "cerradoPor",
     CASE WHEN p.estado<>'Pendiente' THEN p.estado
       WHEN p.fecha_objetivo<(now() AT TIME ZONE 'America/Mexico_City')::date OR p.kilometraje_objetivo<=meters.km OR p.horas_objetivo<=meters.horas THEN 'Vencido'
       WHEN p.fecha_objetivo=(now() AT TIME ZONE 'America/Mexico_City')::date THEN 'Vence hoy'
       WHEN (p.kilometraje_objetivo IS NOT NULL AND meters.km IS NULL) OR (p.horas_objetivo IS NOT NULL AND meters.horas IS NULL) THEN 'Sin lectura suficiente'
       ELSE 'Programado' END AS condicion
     FROM crm_unidad_mantenimiento p CROSS JOIN meters WHERE p.id_unidad=$1
     ORDER BY (p.estado='Pendiente') DESC,p.creada_en DESC,p.id_mantenimiento DESC LIMIT 20 OFFSET $2`,[id,(query.mantenimientosPage-1)*20]);
   const [maintenanceCount]=await queryRows<{total:number}>(manager,'SELECT count(*)::int total FROM crm_unidad_mantenimiento WHERE id_unidad=$1',[id]);
   const archivos=await queryRows(manager,`SELECT id_archivo AS "idArchivo",titulo,nombre,tipo,mime,bytes,sha256,autor_nombre AS autor,creada_en AS "creadaEn",retirado,motivo_retiro AS "motivoRetiro" FROM crm_unidad_archivo WHERE id_unidad=$1 ORDER BY id_archivo DESC`,[id]);
   const [access]=await queryRows<{gestionar:boolean}>(manager,'SELECT fn_effective_permission($1,$2,$3) AS gestionar',[actor.idUser,actor.role,WRITE]);
   return{unidad,kilometrajeActual:actual.km,horasActuales:actual.horas,permisos:{gestionar:access.gestionar,anularRetirar:access.gestionar&&actor.role===RolUsuario.ADMIN},lecturas:{data:lecturas,total:lecturasCount.total,page:query.lecturasPage,limit:20},mantenimientos:{data:mantenimientos,total:maintenanceCount.total,page:query.mantenimientosPage,limit:20},archivos};
  });
 }
 addReading(id:number,dto:LecturaUnidadDto,actor:JwtPayload){
  const fecha=this.date(dto.fecha),km=dto.kilometraje??null,horas=dto.horas??null,notas=dto.notas??'';
  if(km===null&&horas===null)throw new BadRequestException('Captura kilometraje, horas o ambos');
  const hash=fingerprint({fecha,km,horas,notas});
  return this.transaction(id,actor,async(manager,user)=>{
   const [previous]=await queryRows<{id:number;huella:string}>(manager,'SELECT id_lectura AS id,huella FROM crm_unidad_lectura WHERE id_unidad=$1 AND request_id=$2',[id,dto.requestId]);
   if(previous){if(previous.huella!==hash)throw new ConflictException('La clave de lectura ya identifica otros datos');return{idLectura:previous.id};}
   const inconsistent=await queryRows(manager,`SELECT id_lectura FROM crm_unidad_lectura WHERE id_unidad=$1 AND NOT anulada
    AND (($3::numeric IS NOT NULL AND ((fecha<=$2 AND kilometraje>$3) OR (fecha>=$2 AND kilometraje<$3)))
      OR ($4::numeric IS NOT NULL AND ((fecha<=$2 AND horas>$4) OR (fecha>=$2 AND horas<$4)))) LIMIT 1`,[id,fecha,km,horas]);
   if(inconsistent.length)throw new ConflictException('La lectura contradice el kilometraje u horas del historial. Revisa la fecha o anula el registro incorrecto.');
   const [row]=await queryRows<{idLectura:number}>(manager,`INSERT INTO crm_unidad_lectura(id_unidad,request_id,huella,fecha,kilometraje,horas,notas,id_autor,autor_nombre)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id_lectura AS "idLectura"`,[id,dto.requestId,hash,fecha,km,horas,notas,user.id,user.nombre]);return row;
  });
 }
 cancelReading(id:number,reading:number,dto:MotivoExpedienteDto,actor:JwtPayload){return this.transaction(id,actor,async manager=>{
  const [row]=await queryRows<{anulada:boolean;motivo:string|null}>(manager,'SELECT anulada,motivo_anulacion AS motivo FROM crm_unidad_lectura WHERE id_unidad=$1 AND id_lectura=$2',[id,reading]);
  if(!row)throw new NotFoundException('Lectura no encontrada en esta unidad');
  if(row.anulada){if(row.motivo!==dto.motivo)throw new ConflictException('La lectura ya fue anulada con otro motivo');return{message:'Lectura anulada'};}
  await manager.query('UPDATE crm_unidad_lectura SET anulada=true,motivo_anulacion=$3 WHERE id_unidad=$1 AND id_lectura=$2',[id,reading,dto.motivo]);return{message:'Lectura anulada'};
 },true);}
 addMaintenance(id:number,dto:MantenimientoUnidadDto,actor:JwtPayload){
  const fields={titulo:dto.titulo,notas:dto.notas??'',fecha:dto.fechaObjetivo??null,km:dto.kilometrajeObjetivo??null,horas:dto.horasObjetivo??null};
  if(fields.fecha===null&&fields.km===null&&fields.horas===null)throw new BadRequestException('Indica fecha, kilometraje u horas objetivo');
  const hash=fingerprint(fields);
  return this.transaction(id,actor,async(manager,user)=>{
   const [previous]=await queryRows<{id:number;huella:string}>(manager,'SELECT id_mantenimiento AS id,huella FROM crm_unidad_mantenimiento WHERE id_unidad=$1 AND request_id=$2',[id,dto.requestId]);
   if(previous){if(previous.huella!==hash)throw new ConflictException('La clave de mantenimiento ya identifica otros datos');return{idMantenimiento:previous.id};}
   const [quota]=await queryRows<{total:number}>(manager,"SELECT count(*)::int total FROM crm_unidad_mantenimiento WHERE id_unidad=$1 AND estado='Pendiente'",[id]);
   if(quota.total>=100)throw new ConflictException('La unidad ya tiene100 mantenimientos pendientes; revisa los existentes');
   const [row]=await queryRows<{idMantenimiento:number}>(manager,`INSERT INTO crm_unidad_mantenimiento(id_unidad,request_id,huella,titulo,notas,fecha_objetivo,kilometraje_objetivo,horas_objetivo,id_autor,autor_nombre)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id_mantenimiento AS "idMantenimiento"`,[id,dto.requestId,hash,fields.titulo,fields.notas,fields.fecha,fields.km,fields.horas,user.id,user.nombre]);return row;
  });
 }
 closeMaintenance(id:number,maintenance:number,dto:CerrarMantenimientoDto,actor:JwtPayload){
  if(dto.estado==='Realizado'&&!dto.fechaRealizada)throw new BadRequestException('Indica la fecha de realización');
  if(dto.estado==='Cancelado'&&dto.fechaRealizada)throw new BadRequestException('Una cancelación no registra fecha de realización');
  const fecha=dto.fechaRealizada?this.date(dto.fechaRealizada):null;
  return this.transaction(id,actor,async(manager,user)=>{
   const [row]=await queryRows<{estado:string;version:number;fecha_realizada:Date|null;detalle_cierre:string|null}>(manager,'SELECT estado,version,fecha_realizada,detalle_cierre FROM crm_unidad_mantenimiento WHERE id_unidad=$1 AND id_mantenimiento=$2',[id,maintenance]);
   if(!row)throw new NotFoundException('Mantenimiento no encontrado en esta unidad');
   if(row.estado!=='Pendiente'){
    if(row.estado===dto.estado&&row.detalle_cierre===dto.motivo&&(row.fecha_realizada?.toISOString()??null)===fecha)return{message:'Cierre registrado',version:row.version};
    throw new ConflictException('El mantenimiento ya tiene un cierre diferente');
   }
   if(row.version!==dto.version)throw new ConflictException('El mantenimiento cambió; actualiza el expediente');
   await manager.query('UPDATE crm_unidad_mantenimiento SET estado=$3,fecha_realizada=$4,detalle_cierre=$5,id_cierre=$6,cierre_nombre=$7,version=version+1 WHERE id_unidad=$1 AND id_mantenimiento=$2',[id,maintenance,dto.estado,fecha,dto.motivo,user.id,user.nombre]);
   return{message:'Cierre registrado',version:row.version+1};
  });
 }
 upload(id:number,dto:ArchivoUnidadDto,file:Express.Multer.File|undefined,actor:JwtPayload){
  if(!file?.buffer?.length||file.buffer.length>5*1024*1024)throw new BadRequestException('Selecciona un archivo de hasta5MiB');
  const pdf=file.mimetype==='application/pdf'&&file.buffer.subarray(0,5).toString('ascii')==='%PDF-'&&file.buffer.subarray(-1024).toString('latin1').includes('%%EOF');
  const image=['image/jpeg','image/png','image/webp'].includes(file.mimetype)&&!!imageExtension(file.buffer,file.mimetype);
  if(!pdf&&!image)throw new BadRequestException('Se admite PDF, JPEG, PNG o WebP con firma de formato válida');
  const name=Array.from(file.originalname.replace(/\\/g,'/').split('/').pop()!).filter(c=>c.charCodeAt(0)>31&&c.charCodeAt(0)!==127).slice(0,200).join('')||'archivo';
  const sha=createHash('sha256').update(file.buffer).digest('hex'),hash=fingerprint({titulo:dto.titulo,name,mime:file.mimetype,sha});
  return this.transaction(id,actor,async(manager,user)=>{
   const [previous]=await queryRows<{id:number;huella:string}>(manager,'SELECT id_archivo AS id,huella FROM crm_unidad_archivo WHERE id_unidad=$1 AND request_id=$2',[id,dto.requestId]);
   if(previous){if(previous.huella!==hash)throw new ConflictException('La clave de archivo ya identifica otros datos');return{idArchivo:previous.id};}
   const [quota]=await queryRows<{total:number;bytes:string}>(manager,'SELECT count(*)::int total,COALESCE(sum(bytes),0) AS bytes FROM crm_unidad_archivo WHERE id_unidad=$1',[id]);
   if(quota.total>=50||Number(quota.bytes)+file.buffer.length>50*1024*1024)throw new ConflictException('Límite de50 archivos o50MiB por unidad, incluidos retirados; requiere revisar conservación');
   const [row]=await queryRows<{idArchivo:number}>(manager,`INSERT INTO crm_unidad_archivo(id_unidad,request_id,huella,titulo,nombre,tipo,mime,bytes,sha256,id_autor,autor_nombre)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id_archivo AS "idArchivo"`,[id,dto.requestId,hash,dto.titulo,name,pdf?'Documento':'Foto',file.mimetype,file.buffer.length,sha,user.id,user.nombre]);
   await manager.query('INSERT INTO crm_unidad_archivo_contenido(id_archivo,contenido)VALUES($1,$2)',[row.idArchivo,file.buffer]);return row;
  });
 }
 file(id:number,file:number,actor:JwtPayload){return readSnapshot(this.source,async manager=>{
  await manager.query("SET LOCAL statement_timeout='5s'");await this.actor(manager,actor);await this.unit(manager,id);
  const [row]=await queryRows<{mime:string;contenido:Buffer;sha256:string}>(manager,`SELECT a.mime,c.contenido,a.sha256 FROM crm_unidad_archivo a JOIN crm_unidad_archivo_contenido c USING(id_archivo) WHERE a.id_unidad=$1 AND a.id_archivo=$2 AND NOT a.retirado`,[id,file]);
  if(!row)throw new NotFoundException('Archivo no disponible en esta unidad');
  if(createHash('sha256').update(row.contenido).digest('hex')!==row.sha256)throw new ServiceUnavailableException('El archivo no coincide con su huella. Revisa el respaldo antes de usarlo.');return row;
 });}
 withdraw(id:number,file:number,dto:MotivoExpedienteDto,actor:JwtPayload){return this.transaction(id,actor,async manager=>{
  const [row]=await queryRows<{retirado:boolean;motivo:string|null}>(manager,'SELECT retirado,motivo_retiro AS motivo FROM crm_unidad_archivo WHERE id_unidad=$1 AND id_archivo=$2',[id,file]);
  if(!row)throw new NotFoundException('Archivo no encontrado en esta unidad');
  if(row.retirado){if(row.motivo!==dto.motivo)throw new ConflictException('El archivo ya fue retirado con otro motivo');return{message:'Archivo retirado'};}
  await manager.query('UPDATE crm_unidad_archivo SET retirado=true,motivo_retiro=$3 WHERE id_unidad=$1 AND id_archivo=$2',[id,file,dto.motivo]);return{message:'Archivo retirado'};
 },true);}
}
