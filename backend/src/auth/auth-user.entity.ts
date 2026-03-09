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

  @Column({ name: 'role', default: RolUsuario.ADMIN })
  role!: string;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;
}
