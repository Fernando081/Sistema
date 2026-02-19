// backend/src/catalogos/entities/estado.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
@Entity({ name: 'estado' })
export class Estado {
  @PrimaryGeneratedColumn({ name: 'IdEstado' }) idEstado: number;
  @Column({ name: 'Clave' }) clave: string;
  @Column({ name: 'Nombre' }) nombre: string;
}
