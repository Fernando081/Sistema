import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { RolUsuario } from '../common/enums/app.enums';

@Entity({ name: 'auth_user' })
export class AuthUser {
  @PrimaryGeneratedColumn({ name: 'id_user' })
  idUser!: number;

  @Column({ name: 'username', unique: true })
  username!: string;

  @Column({ name: 'password_hash' })
  passwordHash!: string;

  @Column({ name: 'role', default: RolUsuario.USER })
  role!: RolUsuario;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'token_version', default: 0 })
  tokenVersion!: number;
}
