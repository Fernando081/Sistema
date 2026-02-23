// backend/src/categoria/categoria.entity.ts (NUEVO ARCHIVO)
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'categoria' })
export class Categoria {
  @PrimaryGeneratedColumn('identity', { name: 'IdCategoria' })
  idCategoria: number;

  @Column({ type: 'varchar', length: 100, name: 'Descripcion', nullable: true })
  descripcion: string;
}
