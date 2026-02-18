// backend/src/catalogos/entities/uso-cfdi.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
@Entity({ name: 'usocfdi' })
export class UsoCFDI {
  @PrimaryGeneratedColumn({ name: 'IdUsoCFDI' }) idUsoCFDI: number;
  @Column({ name: 'Clave' }) clave: string;
  @Column({ name: 'Nombre' }) nombre: string;
}
