import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Factura } from './factura.entity';

@Entity('cfdi_relacionado')
export class CfdiRelacionado {
  @PrimaryGeneratedColumn({ name: 'id_relacion' })
  idRelacion: number;

  @Column({ name: 'id_factura' })
  idFactura: number;

  @Column({ name: 'tipo_relacion', type: 'varchar', length: 2 })
  tipoRelacion: string;

  @Column({ name: 'uuid_relacionado', type: 'varchar', length: 36 })
  uuidRelacionado: string;

  @ManyToOne(() => Factura, factura => factura.cfdisRelacionados, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'id_factura' })
  factura: Factura;
}
