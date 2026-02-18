// backend/src/catalogos/entities/objeto-impuesto.entity.ts (NUEVO)
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'objetoimpuesto' })
export class ObjetoImpuesto {
  @PrimaryGeneratedColumn({ name: 'IdObjetoImpuesto' })
  idObjetoImpuesto: number;
  @Column({ name: 'Clave' }) clave: string;
  @Column({ name: 'Descripcion' }) descripcion: string;
}
