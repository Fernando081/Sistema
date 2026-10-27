import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrmReporteCrearDto, CrmReporteControlDto, CrmReporteCancelarReintentoDto, CrmReporteReintentoDto } from './crm-reportes.dto';
const base={requestId:'38bf1b26-46bb-47cc-8534-5ffdac4102dd',nombre:' Reporte ',frecuencia:'Diaria',hora:9,minuto:0,tipo:'todos',plazo:'todos'};
describe('C03.2: programación interna cerrada',()=>{
 it.each([0,10,20,30,40,50])('acepta minuto %s y normaliza nombre',async minuto=>{const dto=plainToInstance(CrmReporteCrearDto,{...base,minuto});expect(await validate(dto)).toHaveLength(0);expect(dto.nombre).toBe('Reporte');});
 it.each([{hora:24},{hora:-1},{minuto:5},{nombre:' '},{tipo:'sql'},{plazo:'ayer'},{zona:'UTC'},{idPropietario:1},{sql:'SELECT 1'},{frecuencia:'Mensual'},{dia:8}])('rechaza configuración fuera de contrato %j',async extra=>{expect((await validate(plainToInstance(CrmReporteCrearDto,{...base,...extra}),{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);});
 it.each([{activa:'true',expectedVersion:1},{activa:true,expectedVersion:0},{activa:false,expectedVersion:1,sql:'DELETE'}])('rechaza control inválido %j',async data=>{expect((await validate(plainToInstance(CrmReporteControlDto,data),{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);});
});
describe('O01.1: reintento y cancelación deliberados',()=>{
 it('acepta confirmación explícita y versión de cancelación',async()=>{
  expect(await validate(plainToInstance(CrmReporteReintentoDto,{confirmacion:true}),{whitelist:true,forbidNonWhitelisted:true})).toHaveLength(0);
  expect(await validate(plainToInstance(CrmReporteCancelarReintentoDto,{confirmacion:true,expectedVersion:1}),{whitelist:true,forbidNonWhitelisted:true})).toHaveLength(0);
 });
 it.each([{confirmacion:false},{confirmacion:'true'},{confirmacion:true,sql:'SELECT 1'},{confirmacion:true,idPropietario:1},{}])('rechaza reintento inválido %j',async d=>{
  expect((await validate(plainToInstance(CrmReporteReintentoDto,d),{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);
 });
 it.each([{confirmacion:true},{confirmacion:true,expectedVersion:0},{confirmacion:true,expectedVersion:'1'},{confirmacion:false,expectedVersion:1}])('rechaza cancelación inválida %j',async d=>{
  expect((await validate(plainToInstance(CrmReporteCancelarReintentoDto,d),{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);
 });
});
