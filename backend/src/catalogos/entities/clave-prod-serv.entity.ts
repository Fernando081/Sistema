// backend/src/catalogos/entities/clave-prod-serv.entity.ts
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
@Entity({ name: 'claveproductooservicio' })
export class ClaveProdServ {
  @PrimaryGeneratedColumn({ name: 'IdClaveProdOServ' }) idClaveProdOServ: number;
  @Column({ name: 'Clave' }) clave: string;
  @Column({ name: 'Descripcion' }) descripcion: string;
}