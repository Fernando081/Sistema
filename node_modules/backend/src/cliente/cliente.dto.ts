// backend/src/cliente/cliente.dto.ts
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsInt,
  MinLength,
  IsPostalCode,
  IsEmail,
} from 'class-validator';

// DTO para Crear un Cliente (Validación)
export class CreateClienteDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(13)
  rfc: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  razonSocial: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  pais: string;

  @IsInt()
  @IsOptional()
  idEstado: number;

  @IsInt()
  @IsOptional()
  idMunicipio: number;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  ciudad: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  colonia: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  calle: string;

  @IsString()
  @IsNotEmpty()
  @IsPostalCode('MX') // Valida que sea un CP de México
  @MaxLength(5)
  codigoPostal: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  numeroExterior: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  numeroInterior: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  referencia: string;

  @IsInt()
  @IsOptional()
  idMetodoDePago: number;

  @IsInt()
  @IsOptional()
  idUsoCFDI: number;

  @IsInt()
  @IsOptional()
  idFormaPago: number;

  @IsInt()
  @IsNotEmpty()
  idRegimenFiscal: number;

  @IsString()
  @IsOptional()
  @IsEmail()
  email?: string;
}

// DTO para Actualizar (la mayoría de campos son opcionales)
// Usamos PartialType para no reescribir todo.
import { PartialType } from '@nestjs/mapped-types';
export class UpdateClienteDto extends PartialType(CreateClienteDto) {}
