import { RolUsuario } from '../common/enums/app.enums';

export interface JwtPayload {
  sub: string;
  role: RolUsuario;
  idUser?: number;
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
