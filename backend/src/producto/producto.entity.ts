// backend/src/producto/producto.entity.ts (NUEVO ARCHIVO)
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity({ name: 'producto' })
export class Producto {
  @PrimaryGeneratedColumn('identity', { name: 'IdProducto' })
  idProducto: number;

  @Column({ type: 'varchar', length: 30, name: 'Codigo', unique: true, nullable: true })
  @Index()
  codigo: string;

  @Column({ type: 'int', name: 'IdUnidad', nullable: true })
  idUnidad: number;

  @Column({ type: 'int', name: 'IdObjetoImpuesto', nullable: true })
  idObjetoImpuesto: number;

  @Column({ type: 'varchar', length: 255, name: 'Descripcion' })
  @Index()
  descripcion: string;

  @Column({ type: 'decimal', precision: 18, scale: 6, name: 'PrecioUnitario' })
  precioUnitario: number;

  @Column({ type: 'int', name: 'IdCategoria', nullable: true })
  idCategoria: number;

  @Column({ type: 'varchar', length: 100, name: 'Ubicacion', nullable: true })
  ubicacion: string;

  @Column({ type: 'int', name: 'IdClaveProdOServ', nullable: true })
  idClaveProdOServ: number;

  @Column({ type: 'int', name: 'IdClaveUnidad', nullable: true })
  idClaveUnidad: number;

  @Column({ type: 'varchar', length: 50, name: 'Marca', nullable: true })
  marca: string;

  // --- NUEVOS CAMPOS FISCALES ---
  @Column({ name: 'ObjetoImpuesto', default: '02', length: 2 })
  objetoImpuestoSat: string;

  @Column({ name: 'TasaIVA', type: 'numeric', precision: 18, scale: 6, default: 0.16 })
  tasaIva: number;

  @Column({ name: 'AplicaRetencionISR', type: 'boolean', default: false })
  aplicaRetencionIsr: boolean;

  @Column({ name: 'AplicaRetencionIVA', type: 'boolean', default: false })
  aplicaRetencionIva: boolean;

  @Column({ name: 'Existencia', type: 'numeric', default: 0 })
  existencia: number;

  equivalentesIds?: number[];

  // Join virtual
  categoriaNombre?: string; 
}