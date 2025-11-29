// backend/src/catalogos/entities/clave-unidad.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
@Entity({ name: 'claveunidad' })
export class ClaveUnidad {
  @PrimaryGeneratedColumn({ name: 'IdClaveUnidad' }) idClaveUnidad: number;
  @Column({ name: 'Clave' }) clave: string;
  @Column({ name: 'Descripcion' }) descripcion: string;
}