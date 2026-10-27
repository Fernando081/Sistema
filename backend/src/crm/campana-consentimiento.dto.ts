import { Transform,Type } from 'class-transformer';
import { Equals,IsDateString,IsIn,IsInt,IsOptional,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
export type CommercialChannel='Correo'|'WhatsApp'|'Llamada';
export class CommercialQuery {
 @Type(()=>Number) @IsInt() @Min(1) @Max(1000000) page=1;
 @IsOptional() @Transform(trim) @IsString() @MaxLength(80) q='';
}
export class ConsentQuery extends CommercialQuery {
 @IsIn(['Correo','WhatsApp','Llamada']) canal:CommercialChannel='Correo';
}
export class ConsentDto {
 @IsUUID() requestId:string;
 @IsIn(['Correo','WhatsApp','Llamada']) canal:CommercialChannel;
 @IsIn(['Autorizado','Baja']) estado:'Autorizado'|'Baja';
 @Type(()=>Number) @IsInt() @Min(0) @Max(2147483646) versionAnterior:number;
 @Matches(/^[a-f0-9]{64}$/) destinoHuella:string;
 @IsDateString({strict:true}) ocurridaEn:string;
 @IsOptional() @IsDateString({strict:true}) venceEn?:string;
 @IsIn(['Presencial','Llamada','Correo','WhatsApp','Documento']) fuente:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) referencia:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) motivo:string;
 @Equals(true) confirmacion:boolean;
}
export class PrepareCampaignDto {
 @IsUUID() requestId:string;
 @Matches(/^[a-f0-9]{64}$/) evaluacionSha256:string;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) motivo:string;
 @Equals(true) confirmacion:boolean;
}
