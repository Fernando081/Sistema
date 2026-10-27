import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SecuenciaAplicarDto,SecuenciaReglaDto } from './crm-secuencia-reglas.dto';
const requestId='38bf1b26-46bb-47cc-8534-5ffdac4102dd';
describe('C02.2b: contratos cerrados de reglas y aprobación por evento',()=>{
 it.each(['Prospecto','Contactado','Cotizando','Negociacion','Ganada','Perdida'])('acepta la etapa comercial %s sin instrucciones SQL',async etapa=>{
  const dto=plainToInstance(SecuenciaReglaDto,{requestId,idModelo:requestId,nombre:'  Regla de prueba  ',etapa});expect(await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).toHaveLength(0);expect(dto.nombre).toBe('Regla de prueba');
 });
 it.each([{etapa:'Eliminada'},{nombre:'  '},{sql:'SELECT 1'},{idResponsable:1}])('rechaza reglas fuera del contrato: %j',async extra=>{
  const dto=plainToInstance(SecuenciaReglaDto,{requestId,idModelo:requestId,nombre:'Prueba',etapa:'Cotizando',...extra});expect((await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);
 });
 it('conserva el identificador de evento como texto bigint y exige una huella',async()=>{
  const dto=plainToInstance(SecuenciaAplicarDto,{requestId,idEvento:'9007199254740993',evaluacionSha256:'a'.repeat(64),motivo:'Revisión',confirmacion:true});expect(await validate(dto)).toHaveLength(0);expect(dto.idEvento).toBe('9007199254740993');
 });
 it.each([{confirmacion:false},{idEvento:42},{idEvento:'1 OR 1=1'},{idEvento:'0'},{evaluacionSha256:'abc'},{motivo:' '},{idCliente:7}])('rechaza aplicar sin revisión o inyectando el destino: %j',async extra=>{
  const dto=plainToInstance(SecuenciaAplicarDto,{requestId,idEvento:'42',evaluacionSha256:'a'.repeat(64),motivo:'Revisión',confirmacion:true,...extra});expect((await validate(dto,{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);
 });
});
