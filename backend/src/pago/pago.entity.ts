// backend/src/pago/pago.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity({ name: 'pago' })
export class Pago {
  @PrimaryGeneratedColumn('identity', { name: 'id_pago' })
  idPago: number;

  @Column({ name: 'id_factura', type: 'int' })
  @Index() // Indexamos porque buscaremos pagos por factura seguido
  idFactura: number;

  @Column({
    name: 'fecha_pago',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fechaPago: Date;

  @Column({ name: 'monto', type: 'numeric', precision: 18, scale: 2 })
  monto: number;

  @Column({ name: 'forma_pago', type: 'varchar', length: 50, nullable: true })
  formaPago: string;

  @Column({ name: 'referencia', type: 'varchar', length: 100, nullable: true })
  referencia: string;

  @Column({ name: 'notas', type: 'text', nullable: true })
  notas: string;

  // Opcional: Si usas el módulo de bancos
  @Column({ name: 'id_cuenta_bancaria', type: 'int', nullable: true })
  idCuentaBancaria: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // NOTA: Aquí podrías agregar @ManyToOne hacia la entidad Factura si decidieras crearla como Entity
}
