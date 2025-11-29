// backend/src/catalogos/entities/forma-pago.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
@Entity({ name: 'formadepago' })
export class FormaPago {
  @PrimaryGeneratedColumn({ name: 'IdFormaPago' }) idFormaPago: number;
  @Column({ name: 'Clave' }) clave: string;
  @Column({ name: 'Nombre' }) nombre: string;
}