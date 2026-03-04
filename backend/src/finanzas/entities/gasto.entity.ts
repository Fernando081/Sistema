import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'gasto' })
export class Gasto {
  @PrimaryGeneratedColumn('identity', { name: 'id_gasto' })
  idGasto: number;

  @Column({
    type: 'timestamp with time zone',
    default: () => 'CURRENT_TIMESTAMP',
  })
  fecha: Date;

  @Column({ type: 'varchar', length: 255 })
  concepto: string;

  @Column({ type: 'numeric', precision: 18, scale: 2 })
  monto: number;

  @Column({ type: 'varchar', length: 100 })
  categoria: string;

  @Column({ type: 'varchar', length: 50, name: 'metodo_pago' })
  metodoPago: string;

  @Column({ type: 'int', name: 'id_user', nullable: true })
  idUsuario: number;

  @Column({ type: 'int', name: 'id_compra', nullable: true })
  idCompra: number;

  @Column({
    type: 'timestamp with time zone',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt: Date;
}
