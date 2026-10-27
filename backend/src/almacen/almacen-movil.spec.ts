import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AnularPickingDto, MovilPageQuery, VerificarPickingDto } from './almacen-movil.dto';
const id='38bf1b26-46bb-47cc-8534-5ffdac4102dd',base={requestId:id,idSurtido:'9007199254740993',evaluacionSha256:'a'.repeat(64),producto:'RTT1:P:1',ubicacion:'RTT1:U:2',cantidad:'1.000001',metodo:'Lector',confirmacion:true};
describe('A01: contratos de lectura y verificación sin coma flotante',()=>{
 it.each(['0.000001','1','999999999999.999999'])('conserva cantidades exactas %s y bigint como texto',async cantidad=>{const dto=plainToInstance(VerificarPickingDto,{...base,cantidad});expect(await validate(dto)).toHaveLength(0);expect(dto.cantidad).toBe(cantidad);expect(dto.idSurtido).toBe(base.idSurtido);});
 it.each([{cantidad:1},{cantidad:'1e3'},{cantidad:'-1'},{cantidad:'1,5'},{cantidad:'0.0000001'},{cantidad:'1000000000000'},{idSurtido:'1 OR 1=1'},{idSurtido:7},{confirmacion:false},{metodo:'Automatico'},{idProducto:2},{idActor:1}])('rechaza parámetros que eludan revisión o precisión %j',async extra=>{expect((await validate(plainToInstance(VerificarPickingDto,{...base,...extra}),{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);});
 it('exige motivo y confirmación para corregir sin borrar historia',async()=>{expect((await validate(plainToInstance(AnularPickingDto,{requestId:id,idVerificacion:id,motivo:' ',confirmacion:true}))).length).toBeGreaterThan(0);});
 it.each([{page:0},{page:1.5},{page:10001},{q:'a'.repeat(41)},{estado:'sql'},{idUsuario:1}])('acota consultas y no admite suplantar actor %j',async extra=>{expect((await validate(plainToInstance(MovilPageQuery,extra),{whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);});
});
