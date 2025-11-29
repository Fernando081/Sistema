// backend/src/catalogos/entities/unidad.entity.ts (NUEVO)
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'unidad' })
export class Unidad {
  @PrimaryGeneratedColumn({ name: 'IdUnidad' }) idUnidad: number;
  @Column({ name: 'Descripcion' }) descripcion: string;
}