import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { LoginResponse, JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  private static readonly DEFAULT_JWT_SECRET = 'dev-secret-change-me';
  private readonly jwtSecret = this.getEnvOrDefault('JWT_SECRET', AuthService.DEFAULT_JWT_SECRET);
  private readonly authUser = this.getEnvOrDefault('AUTH_USERNAME', 'admin');
  private readonly authPassword = this.getEnvOrDefault('AUTH_PASSWORD', 'admin123');
  private readonly expiresInSeconds = 60 * 60 * 8;

  constructor() {
    if (process.env.NODE_ENV === 'production' && this.jwtSecret === AuthService.DEFAULT_JWT_SECRET) {
      throw new Error(
        'Invalid JWT configuration: JWT_SECRET must be set to a strong, non-default value in production.',
      );
    }
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


  private getEnvOrDefault(key: string, fallback: string): string {
    const value = process.env[key]?.trim();

    if (!value) {
      return fallback;
    }

    return value;
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
