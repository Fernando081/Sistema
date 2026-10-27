import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RolUsuario } from '../common/enums/app.enums';
import { SecuenciaModeloDto,SecuenciaInicioDto,SecuenciaControlDto } from './crm-secuencias.dto';
import { CrmActividadService } from './crm-actividad.service';
const id='91ac16a2-063a-49de-a00a-6d8951cc8801';
const step={titulo:'Confirmar aplicación',descripcion:'Consultar el VIN o ESN registrado',prioridad:'Media',horas:24};
describe('C02: contratos de secuencias y protección de tareas',()=>{
 it('valida y recorta un modelo con plazo cero y ocho pasos',async()=>{
  const dto=plainToInstance(SecuenciaModeloDto,{requestId:id,nombre:'  Seguimiento  ',pasos:Array.from({length:8},()=>({...step,horas:0}))});
  expect(await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).toHaveLength(0);expect(dto.nombre).toBe('Seguimiento');
 });
 it.each([[],Array.from({length:9},()=>step),[{...step,horas:-1}],[{...step,horas:721}],[{...step,horas:1.5}],[{...step,titulo:'  '}],[{...step,canal:'Correo'}]].map(pasos=>({pasos})))('rechaza pasos o campos fuera del contrato: %j',async ({pasos})=>{
  expect((await validate(plainToInstance(SecuenciaModeloDto,{requestId:id,nombre:'Prueba',pasos}),{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);
 });
 it('requiere confirmación explícita, UUID y responsable válidos al iniciar',async()=>{
  const dto=plainToInstance(SecuenciaInicioDto,{requestId:id,idModelo:id,idCliente:1,idResponsable:1,motivo:'Solicitado por el cliente',confirmacion:false});expect((await validate(dto)).length).toBeGreaterThan(0);
 });
 it.each(['Pausar','Reanudar','Reasignar'])('acepta control %s con UUID, motivo, versión y confirmación',async accion=>{
  const dto=plainToInstance(SecuenciaControlDto,{requestId:id,accion,motivo:'  Cambio operativo  ',expectedVersion:3,confirmacion:true,...(accion==='Reasignar'?{idResponsable:7}:{})});
  expect(await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).toHaveLength(0);expect(dto.motivo).toBe('Cambio operativo');
 });
 it.each([{expectedVersion:0},{expectedVersion:1.5},{confirmacion:false},{accion:'Eliminar'},{motivo:'  '},{sql:'SELECT 1'}])('rechaza controles sin evidencia/versionado o campos ajenos: %j',async override=>{
  const dto=plainToInstance(SecuenciaControlDto,{requestId:id,accion:'Pausar',motivo:'Cambio',expectedVersion:1,confirmacion:true,...override});expect((await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);
 });
 const task={id_tarea:'9007199254740993',id_secuencia:id,estado:'Pendiente',version:1,id_responsable:7,id_creador:7};
 const activity=(row:object)=>{const query=jest.fn().mockResolvedValueOnce([row]).mockResolvedValue([{id_user:7}]);const service=new CrmActividadService({transaction:async(work:(manager:{query:typeof query})=>Promise<unknown>)=>work({query})} as unknown as DataSource);return{service,query};};
 it('rechaza mover o reescribir el contexto de una tarea vinculada',async()=>{const{service,query}=activity(task);await expect(service.updateTarea(task.id_tarea,{titulo:'Cambiar',expectedVersion:1},7,RolUsuario.ADMIN)).rejects.toBeInstanceOf(ConflictException);expect(query.mock.calls.some(c=>String(c[0]).startsWith('UPDATE'))).toBe(false);});
 it('impide reabrir un paso cerrado antes de efectuar escrituras',async()=>{const{service}=activity({...task,estado:'Completada',version:2});await expect(service.updateTarea(task.id_tarea,{estado:'Pendiente',expectedVersion:2},7,RolUsuario.ADMIN)).rejects.toBeInstanceOf(ConflictException);});
 it('conserva el identificador bigint sin convertirlo a Number',async()=>{const{service,query}=activity(task);await service.updateTarea(task.id_tarea,{estado:'En progreso',expectedVersion:1},7,RolUsuario.ADMIN);expect(query.mock.calls.find(c=>String(c[0]).startsWith('UPDATE'))?.[1][0]).toBe(task.id_tarea);});
});
