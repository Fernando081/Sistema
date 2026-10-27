import { RolUsuario } from '../common/enums/app.enums';

export interface JwtPayload {
  sub: string;
  role: RolUsuario;
  idUser?: number;
  sid?: string;
  iat: number;
  exp: number;
  version: number;
  iss: 'sistema-erp';
  aud: 'sistema-web';
}

export interface LoginResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export interface MfaChallenge { mfaRequired: true; challenge: string; expiresIn: number }
export type LoginResult = LoginResponse | MfaChallenge;
