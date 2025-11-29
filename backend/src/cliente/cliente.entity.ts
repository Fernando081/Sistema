// backend/src/cliente/cliente.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity({ name: 'cliente' }) // Nombre de la tabla en minúsculas
export class Cliente {
  @PrimaryGeneratedColumn('identity', { name: 'IdCliente' })
  idCliente: number;

  @Column({ type: 'varchar', length: 13, name: 'RFC', unique: true })
  @Index() // Crear un índice en RFC
  rfc: string;

  @Column({ type: 'varchar', length: 255, name: 'RazonSocial' })
  @Index() // Crear un índice en RazonSocial
  razonSocial: string;

  @Column({ type: 'varchar', length: 50, name: 'Pais', default: 'México' })
  pais: string;

  @Column({ type: 'int', name: 'IdEstado', nullable: true })
  idEstado: number;

  @Column({ type: 'int', name: 'IdMunicipio', nullable: true })
  idMunicipio: number;

  @Column({ type: 'varchar', length: 50, name: 'Ciudad', nullable: true })
  ciudad: string;

  @Column({ type: 'varchar', length: 100, name: 'Colonia', nullable: true })
  colonia: string;

  @Column({ type: 'varchar', length: 100, name: 'Calle', nullable: true })
  calle: string;

  @Column({ type: 'varchar', length: 5, name: 'CodigoPostal' })
  codigoPostal: string;

  @Column({ type: 'varchar', length: 20, name: 'NumeroExterior', nullable: true })
  numeroExterior: string;

  @Column({ type: 'varchar', length: 20, name: 'NumeroInterior', nullable: true })
  numeroInterior: string;

  @Column({ type: 'varchar', length: 100, name: 'Referencia', nullable: true })
  referencia: string;

  @Column({ type: 'int', name: 'IdMetodoDePago', nullable: true })
  idMetodoDePago: number;

  @Column({ type: 'int', name: 'IdUsoCFDI', nullable: true })
  idUsoCFDI: number;

  @Column({ type: 'int', name: 'IdFormaPago', nullable: true })
  idFormaPago: number;

  @Column({ type: 'int', name: 'IdRegimenFiscal' })
  idRegimenFiscal: number;

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string;

  // NOTA: Las relaciones con otras tablas (Estado, Municipio, etc.)
  // se añadirán aquí más adelante con @ManyToOne y @JoinColumn
}