import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNotEmpty, IsNumber,
  IsOptional, IsString, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

export const CRM_ETAPAS = ['Prospecto', 'Contactado', 'Cotizando', 'Negociacion', 'Ganada', 'Perdida'];
export const CRM_MOTIVOS = ['Sin existencia', 'Precio', 'Entrega', 'Compatibilidad', 'Otro'];
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const nullableText = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() || null : value;

export class CrmPageQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @Transform(trim) @IsString() @MaxLength(150) @IsOptional() q?: string;
}

export class OportunidadesQuery extends CrmPageQuery {
  @IsIn(CRM_ETAPAS) @IsOptional() etapa?: string;
  @IsIn(['todas', 'vencidas', 'hoy', 'sin-fecha']) @IsOptional() agenda?: string;
}

export class VentasPerdidasQuery extends CrmPageQuery {
  @IsIn(CRM_MOTIVOS) @IsOptional() motivo?: string;
}

export class BusquedaGlobalQuery {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) q: string;
}

export class CreateSegmentoDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) nombre: string;
  @Transform(nullableText) @IsString() @MaxLength(500) @IsOptional() descripcion?: string | null;
  @IsIn(['Flotilla', 'Taller', 'Transportista', 'Mostrador', 'Otro']) @IsOptional() tipoCliente?: string;
  @IsInt() @Min(0) @Max(3650) @IsOptional() diasInactivo?: number;
}
export class CreatePlantillaDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(120) nombre: string;
  @IsIn(['Llamada', 'Correo', 'WhatsApp']) canal: string;
  @Transform(nullableText) @IsString() @MaxLength(180) @IsOptional() asunto?: string | null;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(5000) contenido: string;
}
export class CreateCampanaDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) nombre: string;
  @IsInt() @Min(1) @IsOptional() idSegmento?: number;
  @IsInt() @Min(1) @IsOptional() idPlantilla?: number;
  @IsDateString() @IsOptional() fechaInicio?: string;
  @IsDateString() @IsOptional() fechaFin?: string;
  @Transform(nullableText) @IsString() @MaxLength(500) @IsOptional() objetivo?: string | null;
}
export class CreateEncuestaDto {
  @IsInt() @Min(1) @IsOptional() idCliente?: number;
  @IsInt() @Min(1) @IsOptional() idOportunidad?: number;
  @IsInt() @Min(1) @Max(5) calificacion: number;
  @Transform(nullableText) @IsString() @MaxLength(1000) @IsOptional() comentario?: string | null;
}
export class CreateMetaDto {
  @IsInt() @Min(1) idUser: number;
  @IsDateString() fechaInicio: string;
  @IsDateString() fechaFin: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) montoObjetivo: number;
  @IsInt() @Min(0) oportunidadesObjetivo: number;
}

export class CrmTareasQuery {
  @IsIn(['Pendiente', 'En progreso', 'Completada', 'Cancelada']) @IsOptional() estado?: string;
  @IsIn(['todas', 'vencidas', 'hoy', 'proximas']) @IsOptional() vencimiento?: string;
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() idResponsable?: number;
}

export class CreateCrmTareaDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(180) titulo: string;
  @Transform(nullableText) @IsString() @MaxLength(2000) @IsOptional() descripcion?: string | null;
  @IsIn(['Baja', 'Media', 'Alta', 'Urgente']) prioridad: string;
  @IsDateString() fechaVencimiento: string;
  @IsInt() @Min(1) idResponsable: number;
  @IsInt() @Min(1) @IsOptional() idCliente?: number;
  @IsInt() @Min(1) @IsOptional() idUnidad?: number;
  @IsInt() @Min(1) @IsOptional() idOportunidad?: number;
  @IsInt() @Min(1) @IsOptional() idCotizacion?: number;
  @IsInt() @Min(1) @IsOptional() idPedido?: number;
}

export class UpdateCrmTareaDto extends PartialType(CreateCrmTareaDto, { skipNullProperties: false }) {
  @IsIn(['Pendiente', 'En progreso', 'Completada', 'Cancelada']) @IsOptional() estado?: string;
  @IsInt() @Min(1) expectedVersion: number;
}

export class CreateCrmComunicacionDto {
  @IsIn(['Llamada', 'Correo', 'WhatsApp', 'Visita', 'Otro']) canal: string;
  @IsIn(['Entrante', 'Saliente']) direccion: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(2000) resumen: string;
  @IsDateString() @IsOptional() fecha?: string;
  @IsInt() @Min(1) @IsOptional() idCliente?: number;
  @IsInt() @Min(1) @IsOptional() idUnidad?: number;
  @IsInt() @Min(1) @IsOptional() idOportunidad?: number;
}

export class CreateOportunidadDto {
  @IsInt() @Min(1) @IsOptional() idCliente?: number | null;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(180) empresa: string;
  @Transform(nullableText) @IsString() @MaxLength(150) @IsOptional() contacto?: string | null;
  @Transform(nullableText) @IsString() @MaxLength(30) @IsOptional() telefono?: string | null;
  @Transform(nullableText) @IsEmail() @MaxLength(150) @IsOptional() email?: string | null;
  @IsIn(['Flotilla', 'Taller', 'Transportista', 'Mostrador', 'Otro']) tipoCliente: string;
  @IsIn(CRM_ETAPAS) etapa: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999999999999.99) montoEstimado: number;
  @Transform(nullableText) @IsString() @MaxLength(255) @IsOptional() siguienteAccion?: string | null;
  @Transform(nullableText) @IsDateString({ strict: true }) @IsOptional() fechaSiguienteAccion?: string | null;
  @Transform(nullableText) @IsString() @MaxLength(100) @IsOptional() motivoPerdida?: string | null;
}

export class UpdateOportunidadDto extends PartialType(CreateOportunidadDto, { skipNullProperties: false }) {
  @IsInt() @Min(1) @IsOptional() expectedVersion?: number;
}

export class CreateSeguimientoDto {
  @IsIn(['Llamada', 'WhatsApp', 'Correo', 'Visita', 'Nota']) tipo: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(2000) detalle: string;
  @IsBoolean() @IsOptional() completarAccion?: boolean;
  @Transform(nullableText) @IsString() @MaxLength(255) @IsOptional() siguienteAccion?: string | null;
  @Transform(nullableText) @IsDateString({ strict: true }) @IsOptional() fechaSiguienteAccion?: string | null;
  @IsInt() @Min(1) @IsOptional() expectedVersion?: number;
}

export class CreateVentaPerdidaDto {
  @IsInt() @Min(1) @IsOptional() idOportunidad?: number | null;
  @IsInt() @Min(1) @IsOptional() idCliente?: number | null;
  @IsInt() @Min(1) @IsOptional() idProducto?: number | null;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(255) descripcionBuscada: string;
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) @Max(999999999999) cantidad: number;
  @IsIn(CRM_MOTIVOS) motivo: string;
  @Transform(nullableText) @IsString() @MaxLength(2000) @IsOptional() notas?: string | null;
}

export class CreateUnidadClienteDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() || null : value)
  @IsString() @MaxLength(17) @IsOptional()
  vin?: string | null;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() || null : value)
  @IsString() @MaxLength(50) @IsOptional()
  esn?: string | null;

  @Transform(nullableText) @IsString() @MaxLength(50) @IsOptional() numeroEconomico?: string | null;
  @Transform(nullableText) @IsString() @MaxLength(80) @IsOptional() marca?: string | null;
  @Transform(nullableText) @IsString() @MaxLength(100) @IsOptional() modelo?: string | null;
  @Type(() => Number) @IsInt() @Min(1900) @Max(2200) @IsOptional() anio?: number | null;
  @Transform(nullableText) @IsString() @MaxLength(120) @IsOptional() motor?: string | null;
  @Transform(nullableText) @IsString() @MaxLength(1000) @IsOptional() notas?: string | null;
}

export class UpdateUnidadClienteDto extends PartialType(CreateUnidadClienteDto, { skipNullProperties: false }) {}
