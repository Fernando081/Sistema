// backend/src/catalogos/entities/regimen-fiscal.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
@Entity({ name: 'regimenfiscal' })
export class RegimenFiscal {
  @PrimaryGeneratedColumn({ name: 'IdRegimenFiscal' }) idRegimenFiscal: number;
  @Column({ name: 'Clave' }) clave: string;
  @Column({ name: 'Nombre' }) nombre: string;
}