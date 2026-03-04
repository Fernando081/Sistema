import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'saldos' })
export class Saldo {
  @PrimaryGeneratedColumn('identity', { name: 'id_saldo' })
  idSaldo: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'caja_chica' })
  cajaChica: number;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'cuenta_banco' })
  cuentaBanco: number;

  @Column({
    type: 'timestamp with time zone',
    name: 'updated_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  updatedAt: Date;
}
