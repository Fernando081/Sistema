import { Transform,Type } from 'class-transformer';
import { IsIn,IsInt,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength } from 'class-validator';
export class PortalSourceDto {
 @IsIn(['xml','acuse','cotizacion','entrega']) tipo:'xml'|'acuse'|'cotizacion'|'entrega';
 @Type(()=>Number) @IsInt() @Min(1) @Max(2147483647) origen:number;
}
export class PortalPublishDto extends PortalSourceDto {
 @IsUUID() requestId:string;
 @Matches(/^[a-f0-9]{64}$/) origenSha256:string;
 @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim():value) @IsString() @MinLength(1) @MaxLength(500) motivo:string;
}
export class PortalWithdrawDto {
 @IsUUID() requestId:string;
 @Transform(({value}:{value:unknown})=>typeof value==='string'?value.trim():value) @IsString() @MinLength(1) @MaxLength(500) motivo:string;
}
