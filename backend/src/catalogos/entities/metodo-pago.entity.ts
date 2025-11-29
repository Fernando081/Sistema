// backend/src/catalogos/entities/metodo-pago.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
@Entity({ name: 'metododepago' })
export class MetodoPago {
  @PrimaryGeneratedColumn({ name: 'IdMetodoDePago' }) idMetodoDePago: number;
  @Column({ name: 'Clave' }) clave: string;
  @Column({ name: 'Nombre' }) nombre: string;
}