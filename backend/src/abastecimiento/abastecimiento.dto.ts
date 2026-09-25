import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
const trim = ({value}:{value:unknown}) => typeof value === 'string' ? value.trim() : value;
export class SolicitudLineaDto {
  @IsInt() @Min(1) idProducto:number;
  @IsNumber({maxDecimalPlaces:6}) @Min(0.000001) cantidad:number;
  @IsNumber({maxDecimalPlaces:6}) @Min(0) costoEstimado=0;
  @IsIn(['Manual','Backorder','Minimo','Pronostico']) origen='Manual';
}
export class CreateSolicitudDto {
  @IsUUID() requestId:string;
  @Transform(trim) @IsString() @MaxLength(1000) @IsOptional() motivo?:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>SolicitudLineaDto) partidas:SolicitudLineaDto[];
}
export class OrdenLineaDto {
  @IsInt() @Min(1) idProducto:number;
  @IsNumber({maxDecimalPlaces:6}) @Min(0.000001) cantidad:number;
  @IsNumber({maxDecimalPlaces:6}) @Min(0) costoUnitario:number;
  @IsNumber({maxDecimalPlaces:6}) @Min(0) tasaIva=0.16;
}
export class CreateOrdenDto {
  @IsUUID() requestId:string;
  @IsInt() @Min(1) idProveedor:number;
  @IsInt() @Min(1) @IsOptional() idSolicitud?:number;
  @IsDateString() @IsOptional() fechaPromesa?:string;
  @Transform(trim) @IsString() @MaxLength(1000) @IsOptional() notas?:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>OrdenLineaDto) partidas:OrdenLineaDto[];
}
export class RecepcionLineaDto { @IsInt() @Min(1) idDetalle:number; @IsNumber({maxDecimalPlaces:6}) @Min(0.000001) cantidad:number; }
export class CreateRecepcionDto {
  @IsUUID() requestId:string;
  @Transform(trim) @IsString() @MaxLength(100) @IsOptional() referencia?:string;
  @Transform(trim) @IsString() @MaxLength(1000) @IsOptional() notas?:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>RecepcionLineaDto) partidas:RecepcionLineaDto[];
}
export class CreateCostoAdicionalDto {
  @IsUUID() requestId:string;
  @IsIn(['Flete','Seguro','Importacion','Maniobras','Otro']) tipo:string;
  @IsNumber({maxDecimalPlaces:2}) @Min(0.01) monto:number;
  @IsIn(['Valor','Cantidad']) criterio:'Valor'|'Cantidad'='Valor';
  @Transform(trim) @IsString() @MaxLength(500) @IsOptional() notas?:string;
}
export class DevolucionProveedorLineaDto { @IsInt() @Min(1) idRecepcionDetalle:number; @IsNumber({maxDecimalPlaces:6}) @Min(0.000001) cantidad:number; }
export class CreateDevolucionProveedorDto {
  @IsUUID() requestId:string; @IsInt() @Min(1) idRecepcion:number;
  @Transform(trim) @IsString() @MaxLength(500) motivo:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({each:true}) @Type(()=>DevolucionProveedorLineaDto) partidas:DevolucionProveedorLineaDto[];
}
export class CreateEvaluacionProveedorDto {
  @IsInt() @Min(1) idProveedor:number; @IsInt() @Min(1) @IsOptional() idOrden?:number;
  @IsInt() @Min(1) @Max(5) precio:number; @IsInt() @Min(1) @Max(5) entrega:number; @IsInt() @Min(1) @Max(5) calidad:number; @IsInt() @Min(1) @Max(5) atencion:number;
  @Transform(trim) @IsString() @MaxLength(1000) @IsOptional() comentario?:string;
}
