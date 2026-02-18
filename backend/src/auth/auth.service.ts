import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { Repository } from 'typeorm';
import { LoginResponse, JwtPayload } from './auth.types';
import { AuthUser } from './auth-user.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly jwtSecret = this.getEnvOrDefault(
    'JWT_SECRET',
    'dev-secret-change-me',
  );
  private readonly authUser = this.getEnvOrDefault('AUTH_USERNAME', 'admin');
  private readonly authPassword = this.getEnvOrDefault(
    'AUTH_PASSWORD',
    'admin123',
  );
  private readonly expiresInSeconds = 60 * 60 * 8;

  constructor(
    @InjectRepository(AuthUser)
    private readonly authUserRepository: Repository<AuthUser>,
  ) {
    this.validateProductionSecurity();
  }

  private validateProductionSecurity(): void {
    const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction) {
      const defaultJwtSecret = 'dev-secret-change-me';
      const defaultUsername = 'admin';
      const defaultPassword = 'admin123';

      if (this.jwtSecret === defaultJwtSecret) {
        throw new Error(
          'SECURITY ERROR: JWT_SECRET must be changed from default value in production. ' +
            'Set a strong JWT_SECRET environment variable.',
        );
      }

      if (this.authUser === defaultUsername) {
        throw new Error(
          'SECURITY ERROR: Default username (admin) must be changed in production. ' +
            'Set AUTH_USERNAME environment variable to a secure value.',
        );
      }

      if (this.authPassword === defaultPassword) {
        throw new Error(
          'SECURITY ERROR: Default password (admin123) must be changed in production. ' +
            'Set AUTH_PASSWORD environment variable to a secure value.',
        );
      }

      this.logger.log('Production security validation passed');
    }
  }

  async register(
    username: string,
    password: string,
    role = 'admin',
  ): Promise<{ idUser: number; username: string; role: string }> {
    const existingUser = await this.authUserRepository.findOne({
      where: { username },
    });

    if (existingUser) {
      throw new ConflictException('El usuario ya existe');
    }

    const newUser = this.authUserRepository.create({
      username,
      passwordHash: AuthService.hashPassword(password),
      role,
      isActive: true,
    });

    const savedUser = await this.authUserRepository.save(newUser);

    return {
      idUser: savedUser.idUser,
      username: savedUser.username,
      role: savedUser.role,
    };
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const dbUser = await this.validateFromDatabase(username, password);

    if (!dbUser) {
      const validUser = this.safeCompare(username, this.authUser);
      const validPass = this.safeCompare(password, this.authPassword);

      if (!validUser || !validPass) {
        throw new UnauthorizedException('Credenciales inválidas');
      }
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: username,
      role: dbUser?.role || 'admin',
      iat: issuedAt,
      exp: issuedAt + this.expiresInSeconds,
    };

    return {
      access_token: this.sign(payload),
      token_type: 'Bearer',
      expires_in: this.expiresInSeconds,
    };
  }

  verify(token: string): JwtPayload {
    const [headerPart, payloadPart, signaturePart] = token.split('.');
    if (!headerPart || !payloadPart || !signaturePart) {
      throw new UnauthorizedException('Token inválido');
    }

    const data = `${headerPart}.${payloadPart}`;
    const expectedSignature = this.base64Url(
      createHmac('sha256', this.jwtSecret).update(data).digest('base64'),
    );

    if (!this.safeCompare(signaturePart, expectedSignature)) {
      throw new UnauthorizedException('Firma JWT inválida');
    }

    const payload = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf-8'),
    ) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expirado');
    }

    return payload;
  }

  private async validateFromDatabase(
    username: string,
    password: string,
  ): Promise<AuthUser | null> {
    try {
      const user = await this.authUserRepository.findOne({
        where: { username, isActive: true },
      });
      if (!user) {
        return null;
      }

      return this.verifyPassword(password, user.passwordHash) ? user : null;
    } catch {
      this.logger.error(
        'No se pudo validar auth contra BD. Se usará fallback por env.',
      );
      return null;
    }
  }

  private verifyPassword(
    password: string,
    storedHash: string | null | undefined,
  ): boolean {
    // Validate that storedHash matches expected format (salt:hash) before splitting
    if (!storedHash || typeof storedHash !== 'string') {
      this.logger.error(
        'Invalid password hash: storedHash is null, undefined, empty, or not a string',
      );
      return false;
    }

    if (!storedHash.includes(':')) {
      this.logger.error(
        'Invalid password hash format: expected format with colon separator (salt:hash)',
      );
      return false;
    }

    const parts = storedHash.split(':');
    if (parts.length !== 2) {
      this.logger.error(
        `Invalid password hash format: expected exactly one colon separator but found ${parts.length - 1}`,
      );
      return false;
    }

    const [salt, hash] = parts;
    if (!salt || !hash) {
      this.logger.error('Invalid password hash format: salt or hash is empty');
      return false;
    }

    const passwordHash = scryptSync(password, salt, 64).toString('hex');
    return this.safeCompare(passwordHash, hash);
  }

  static hashPassword(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
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
