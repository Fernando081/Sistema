import { Transform } from 'class-transformer';
import { Equals,IsIn,IsNotEmpty,IsString,IsUUID,Matches,MaxLength } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export class SecuenciaReglaDto {
 @IsUUID('4') requestId!:string;
 @IsUUID('4') idModelo!:string;
 @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) nombre!:string;
 @IsIn(['Prospecto','Contactado','Cotizando','Negociacion','Ganada','Perdida']) etapa!:string;
}
export class SecuenciaAplicarDto {
 @IsUUID('4') requestId!:string;
 @IsString() @MaxLength(19) @Matches(/^[1-9]\d*$/) idEvento!:string;
 @IsString() @Matches(/^[a-f0-9]{64}$/) evaluacionSha256!:string;
 @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(500) motivo!:string;
 @Equals(true) confirmacion!:boolean;
}
