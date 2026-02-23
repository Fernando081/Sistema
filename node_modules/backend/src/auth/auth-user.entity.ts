import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'auth_user' })
export class AuthUser {
  @PrimaryGeneratedColumn({ name: 'id_user' })
  idUser!: number;

  @Column({ name: 'username', unique: true })
  username!: string;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column({ name: 'role', default: 'admin' })
  role!: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;
}
