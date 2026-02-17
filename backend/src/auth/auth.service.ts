import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { LoginResponse, JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  private readonly jwtSecret = process.env.JWT_SECRET || 'dev-secret-change-me';
  private readonly authUser = process.env.AUTH_USERNAME || 'admin';
  private readonly authPassword = process.env.AUTH_PASSWORD || 'admin123';
  private readonly expiresInSeconds = 60 * 60 * 8;
  private readonly jwtSecret: string;
  private readonly authUser: string;
  private readonly authPassword: string;
  private readonly expiresInSeconds = 60 * 60 * 8;

  constructor() {
    const nodeEnv = process.env.NODE_ENV ?? 'development';

    const jwtSecretFromEnv = process.env.JWT_SECRET;
    if (!jwtSecretFromEnv) {
      if (nodeEnv !== 'development' && nodeEnv !== 'test') {
        throw new Error('JWT_SECRET environment variable must be set in non-development environments');
      }
      this.jwtSecret = 'dev-secret-change-me';
    } else {
      this.jwtSecret = jwtSecretFromEnv;
    }

    const authUserFromEnv = process.env.AUTH_USERNAME;
    const authPasswordFromEnv = process.env.AUTH_PASSWORD;

    if (!authUserFromEnv || !authPasswordFromEnv) {
      throw new Error('AUTH_USERNAME and AUTH_PASSWORD environment variables must be set');
    }

    this.authUser = authUserFromEnv;
    this.authPassword = authPasswordFromEnv;
  }
  login(username: string, password: string): LoginResponse {
    const validUser = this.safeCompare(username, this.authUser);
    const validPass = this.safeCompare(password, this.authPassword);

    if (!validUser || !validPass) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: username,
      role: 'admin',
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

    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8')) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Token expirado');
    }

    return payload;
  }

  private sign(payload: JwtPayload): string {
    const header = this.base64Url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64'));
    const body = this.base64Url(Buffer.from(JSON.stringify(payload)).toString('base64'));
    const data = `${header}.${body}`;
    const signature = this.base64Url(createHmac('sha256', this.jwtSecret).update(data).digest('base64'));
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
