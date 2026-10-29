import { Transform,Type } from 'class-transformer';
import { Equals,IsInt,IsString,IsUUID,Max,MaxLength,Min,MinLength } from 'class-validator';
const trim=({value}:{value:unknown})=>typeof value==='string'?value.trim():value;
/** O01.2c · Inicia la simulación de una campaña desde su preparación vigente. */
export class StartCampaignSimulationDto {
 @IsUUID() requestId:string;
 @Type(()=>Number) @IsInt() @Min(1) @Max(2147483647) idPreparacion:number;
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) motivo:string;
 @Equals(true) confirmacion:boolean;
}
export class CancelCampaignSimulationDto {
 @Transform(trim) @IsString() @MinLength(1) @MaxLength(500) motivo:string;
 @Equals(true) confirmacion:boolean;
}
