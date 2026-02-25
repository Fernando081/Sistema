export interface JwtPayload {
  sub: string;
  role: string;
  iat: number;
  exp: number;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}
