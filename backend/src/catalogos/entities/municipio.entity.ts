// backend/src/catalogos/entities/municipio.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
@Entity({ name: 'municipio' })
export class Municipio {
  @PrimaryGeneratedColumn({ name: 'IdMunicipio' }) idMunicipio: number;
  @Column({ name: 'Clave' }) clave: string;
  @Column({ name: 'Nombre' }) nombre: string;
  @Column({ name: 'ClaveEstado' }) claveEstado: string;
}