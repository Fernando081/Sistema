import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { RolUsuario } from '../common/enums/app.enums';
import { LoginResponse, JwtPayload } from './auth.types';
import { AuthUser } from './auth-user.entity';
import { ChangePasswordDto, UpdateUserDto } from './auth.dto';
import { queryRows } from '../common/database/typed-query';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly hasConfiguredJwtSecret = Boolean(process.env.JWT_SECRET);
  private readonly jwtSecret = process.env.JWT_SECRET || randomBytes(32).toString('hex');
  private readonly authUser = this.getEnvOrDefault('AUTH_USERNAME', RolUsuario.ADMIN);
  private readonly authPassword = process.env.AUTH_PASSWORD ?? '';
  private readonly expiresInSeconds = 60 * 60 * 8;

  constructor(
    @InjectRepository(AuthUser)
    private readonly authUserRepository: Repository<AuthUser>,
  ) {
    this.validateProductionSecurity();
    if (!this.hasConfiguredJwtSecret && process.env.NODE_ENV !== 'test') {
      this.logger.warn('JWT_SECRET no está configurado; se usará una clave temporal hasta reiniciar.');
    }
  }

  private validateProductionSecurity(): void {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      if (!this.hasConfiguredJwtSecret || Buffer.byteLength(this.jwtSecret, 'utf8') < 32 || this.jwtSecret.startsWith('replace-')) {
        throw new Error(
          'SECURITY ERROR: Configura JWT_SECRET aleatorio de al menos 32 bytes en producción.',
        );
      }

      if (process.env.ALLOW_ENV_AUTH?.trim().toLowerCase() === 'true') {
        throw new Error(
          'SECURITY ERROR: ALLOW_ENV_AUTH debe estar deshabilitado en producción.',
        );
      }

      this.logger.log('Production security validation passed');
    }
  }

  async register(
    username: string,
    password: string,
    role = RolUsuario.USER,
  ): Promise<{ idUser: number; username: string; role: string }> {
    username = username.trim();
    if (!/^\S{3,100}$/.test(username) || !Object.values(RolUsuario).includes(role)) {
      throw new BadRequestException('Usuario o rol inválido');
    }
    this.validateNewPassword(password);
    const existingUser = await this.authUserRepository.findOne({
      where: { username },
    });

    if (existingUser) {
      throw new ConflictException('El usuario ya existe');
    }

    const passwordHash = await AuthService.hashPassword(password);
    const newUser = this.authUserRepository.create({
      username,
      passwordHash,
      role,
      isActive: true,
      tokenVersion: 0,
    });

    try {
      const savedUser = await this.authUserRepository.save(newUser);

      this.logger.log(
        `User registered successfully: username=${savedUser.username}, role=${savedUser.role}, idUser=${savedUser.idUser}`,
      );

      return {
        idUser: savedUser.idUser,
        username: savedUser.username,
        role: savedUser.role,
      };
    } catch (error) {
      // Handle race condition: unique constraint violation
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new ConflictException('El usuario ya existe');
      }
      throw error;
    }
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const normalizedUsername = username.trim();
    const dbResult = await this.validateFromDatabase(normalizedUsername, password);
    if (!dbResult.databaseAvailable) {
      throw new ServiceUnavailableException('No fue posible iniciar sesión. Intenta nuevamente.');
    }
    const dbUser = dbResult.user;

    if (!dbUser) {
      if (dbResult.userFound) {
        throw new UnauthorizedException('Credenciales inválidas');
      }

      const allowEnvironmentAuth =
        process.env.NODE_ENV !== 'production' &&
        process.env.ALLOW_ENV_AUTH?.trim().toLowerCase() === 'true' && Boolean(this.authPassword);
      if (!allowEnvironmentAuth) {
        throw new UnauthorizedException('Credenciales inválidas');
      }

      const validUser = this.safeCompare(normalizedUsername, this.authUser);
      const validPass = this.safeCompare(password, this.authPassword);

      if (!validUser || !validPass) {
        throw new UnauthorizedException('Credenciales inválidas');
      }
      
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: normalizedUsername,
      role: dbUser?.role || RolUsuario.ADMIN,
      idUser: dbUser?.idUser,
      iat: issuedAt,
      exp: issuedAt + this.expiresInSeconds,
      version: dbUser?.tokenVersion ?? 0,
      iss: 'sistema-erp',
      aud: 'sistema-web',
    };

    return {
      access_token: this.sign(payload),
      token_type: 'Bearer',
      expires_in: this.expiresInSeconds,
    };
  }

  verify(token: string): JwtPayload {
    if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new UnauthorizedException('Token inválido');
    }
    const [headerPart, payloadPart, signaturePart] = token.split('.');
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new UnauthorizedException('Token inválido');
    }

    let header: { alg?: string; typ?: string };
    let payload: JwtPayload;
    try {
      header = JSON.parse(
        Buffer.from(headerPart, 'base64url').toString('utf-8'),
      ) as { alg?: string; typ?: string };
      payload = JSON.parse(
        Buffer.from(payloadPart, 'base64url').toString('utf-8'),
      ) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }

    if (!header || !payload || header.alg !== 'HS256' || header.typ !== 'JWT') {
      throw new UnauthorizedException('Token inválido');
    }

    const data = `${headerPart}.${payloadPart}`;
    const expectedSignature = this.base64Url(
      createHmac('sha256', this.jwtSecret).update(data).digest('base64'),
    );

    if (!this.safeCompare(signaturePart, expectedSignature)) {
      throw new UnauthorizedException('Firma JWT inválida');
    }

    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 || payload.sub.length > 255 ||
      !Object.values(RolUsuario).includes(payload.role) ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
      !Number.isSafeInteger(payload.version) || payload.version < 0 ||
      payload.iss !== 'sistema-erp' || payload.aud !== 'sistema-web' ||
      (payload.idUser !== undefined && (!Number.isSafeInteger(payload.idUser) || payload.idUser <= 0)) ||
      payload.iat > Math.floor(Date.now() / 1000) + 30 || payload.exp <= payload.iat ||
      payload.exp - payload.iat > this.expiresInSeconds
    ) {
      throw new UnauthorizedException('Token inválido');
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expirado');
    }

    return payload;
  }

  async authenticate(token: string): Promise<JwtPayload> {
    const payload = this.verify(token);
    if (!payload.idUser) {
      if (process.env.NODE_ENV === 'production' || process.env.ALLOW_ENV_AUTH?.trim().toLowerCase() !== 'true' || payload.sub !== this.authUser) {
        throw new UnauthorizedException('Sesión inválida');
      }
      // Un usuario persistido nunca puede autenticarse mediante el fallback.
      const existing = await this.authUserRepository.findOne({ where: { username: payload.sub } });
      if (existing) throw new UnauthorizedException('Inicia sesión con tu cuenta registrada');
      return payload;
    }
    const user = await this.authUserRepository.findOne({ where: { idUser: payload.idUser } });
    if (!user || !user.isActive || user.username !== payload.sub || (user.tokenVersion ?? 0) !== payload.version || user.role !== payload.role) {
      throw new UnauthorizedException('La sesión fue revocada. Inicia sesión nuevamente.');
    }
    return payload;
  }

  profile(payload: JwtPayload) {
    return { idUser: payload.idUser ?? 0, username: payload.sub, role: payload.role, isActive: true };
  }

  async listUsers() {
    return this.authUserRepository.find({
      select: { idUser: true, username: true, role: true, isActive: true },
      order: { username: 'ASC' },
      take: 500,
    });
  }

  async updateUser(id: number, changes: UpdateUserDto, actor: JwtPayload) {
    if (!Number.isSafeInteger(id) || id <= 0 || !Object.keys(changes).length ||
      (changes.role !== undefined && !Object.values(RolUsuario).includes(changes.role)) ||
      (changes.isActive !== undefined && typeof changes.isActive !== 'boolean')) {
      throw new BadRequestException('Indica un usuario y cambios válidos');
    }
    return this.authUserRepository.manager.transaction(async (manager) => {
      // Serializa cambios administrativos para conservar al menos un administrador activo.
      await manager.query("SELECT pg_advisory_xact_lock(hashtext('auth-user-administration'))");
      const repo = manager.getRepository(AuthUser);
      const user = await repo.findOne({ where: { idUser: id }, lock: { mode: 'pessimistic_write' } });
      if (!user) throw new NotFoundException('Usuario no encontrado');
      const nextRole = changes.role ?? user.role;
      const nextActive = changes.isActive ?? user.isActive;
      if (id === actor.idUser && (!nextActive || nextRole !== RolUsuario.ADMIN)) {
        throw new BadRequestException('No puedes desactivar ni retirar el rol administrador de tu propia cuenta');
      }
      if (user.role === RolUsuario.ADMIN && user.isActive && (nextRole !== RolUsuario.ADMIN || !nextActive)) {
        if (await repo.countBy({ role: RolUsuario.ADMIN, isActive: true }) <= 1) {
          throw new BadRequestException('Debe permanecer al menos un administrador activo');
        }
      }
      if (nextRole !== user.role || nextActive !== user.isActive) {
        user.tokenVersion = (user.tokenVersion ?? 0) + 1;
        user.role = nextRole;
        user.isActive = nextActive;
        await repo.save(user);
      }
      this.logger.log(`User access updated: idUser=${id}, actor=${actor.idUser ?? 'bootstrap'}`);
      return { idUser: user.idUser, username: user.username, role: user.role, isActive: user.isActive };
    });
  }

  async getUserPermissions(id:number){
    const user=await this.authUserRepository.findOne({where:{idUser:id}});
    if(!user)throw new NotFoundException('Usuario no encontrado');
    return queryRows<{permissionCode:string;description:string;granted:boolean;overridden:boolean}>(this.authUserRepository.manager,`
      SELECT p.code AS "permissionCode",p.description,
        coalesce(up.granted,exists(SELECT 1 FROM app_role_permission rp WHERE rp.role=$2 AND rp.permission_code=p.code)) AS granted,
        up.permission_code IS NOT NULL AS overridden
      FROM app_permission p LEFT JOIN app_user_permission up ON up.id_user=$1 AND up.permission_code=p.code
      ORDER BY split_part(p.code,'.',1),p.code`,[id,user.role]);
  }

  async updateUserPermissions(id:number,permissions:Array<{permissionCode:string;granted:boolean}>){
    if(new Set(permissions.map(item=>item.permissionCode)).size!==permissions.length)throw new BadRequestException('Hay permisos repetidos');
    return this.authUserRepository.manager.transaction(async manager=>{
      const users=await queryRows<{id_user:number}>(manager,'SELECT id_user FROM auth_user WHERE id_user=$1 FOR UPDATE',[id]);
      if(!users.length)throw new NotFoundException('Usuario no encontrado');
      const valid=permissions.length?await queryRows<{code:string}>(manager,'SELECT code FROM app_permission WHERE code=ANY($1::text[])',[permissions.map(item=>item.permissionCode)]):[];
      if(valid.length!==permissions.length)throw new BadRequestException('La lista contiene permisos desconocidos');
      await manager.query('DELETE FROM app_user_permission WHERE id_user=$1',[id]);
      for(const item of permissions)await manager.query(`INSERT INTO app_user_permission(id_user,permission_code,granted) VALUES($1,$2,$3)`,[id,item.permissionCode,item.granted]);
      return {message:'Permisos actualizados'};
    });
  }

  async changePassword(actor: JwtPayload, body: ChangePasswordDto) {
    if (!actor.idUser) throw new BadRequestException('Registra una cuenta persistida antes de cambiar la contraseña');
    this.validateNewPassword(body.newPassword);
    await this.authUserRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AuthUser);
      const user = await repo.findOne({ where: { idUser: actor.idUser }, lock: { mode: 'pessimistic_write' } });
      if (!user || !user.isActive || user.tokenVersion !== actor.version || !await this.verifyPassword(body.currentPassword, user.passwordHash)) {
        throw new UnauthorizedException('La contraseña actual o la sesión no son válidas');
      }
      user.passwordHash = await AuthService.hashPassword(body.newPassword);
      user.tokenVersion += 1;
      await repo.save(user);
    });
    return { message: 'Contraseña actualizada. Inicia sesión nuevamente en tus dispositivos.' };
  }

  async logout(actor: JwtPayload) {
    if (actor.idUser) {
      await this.authUserRepository.increment({ idUser: actor.idUser }, 'tokenVersion', 1);
    }
    return { message: 'Sesiones cerradas' };
  }

  private validateNewPassword(password: string) {
    if (typeof password !== 'string' || password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) {
      throw new BadRequestException('La contraseña debe tener al menos 10 caracteres y máximo 72 bytes');
    }
  }

  private async validateFromDatabase(
    username: string,
    password: string,
  ): Promise<{
    user: AuthUser | null;
    databaseAvailable: boolean;
    userFound: boolean;
  }> {
    try {
      const user = await this.authUserRepository.findOne({
        where: { username },
      });
      if (!user) {
        return { user: null, databaseAvailable: true, userFound: false };
      }
      if (!user.isActive) {
        return { user: null, databaseAvailable: true, userFound: true };
      }

      const isValid = await this.verifyPassword(password, user.passwordHash);
      return {
        user: isValid ? user : null,
        databaseAvailable: true,
        userFound: true,
      };
    } catch {
      this.logger.error(
        'No se pudo validar autenticación contra la base de datos.',
      );
      return { user: null, databaseAvailable: false, userFound: false };
    }
  }

  private async verifyPassword(
    password: string,
    storedHash: string | null | undefined,
  ): Promise<boolean> {
    if (!storedHash || typeof storedHash !== 'string') {
      this.logger.error(
        'Invalid password hash: storedHash is null, undefined, empty, or not a string',
      );
      return false;
    }

    return bcrypt.compare(password, storedHash);
  }

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  private getEnvOrDefault(key: string, fallback: string): string {
    const value = process.env[key]?.trim();
    return value || fallback;
  }

  private sign(payload: JwtPayload): string {
    const header = this.base64Url(
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
        'base64',
      ),
    );
    const body = this.base64Url(
      Buffer.from(JSON.stringify(payload)).toString('base64'),
    );
    const data = `${header}.${body}`;
    const signature = this.base64Url(
      createHmac('sha256', this.jwtSecret).update(data).digest('base64'),
    );
    return `${data}.${signature}`;
  }

  private safeCompare(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
  }

  private base64Url(value: string): string {
    return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
}
