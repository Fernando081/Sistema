export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  profile: {idUser:number;username:string;role:'admin'|'user';isActive:boolean};
  expiresAt: number;
}

export interface MfaChallenge {mfaRequired:true;challenge:string;expiresIn:number}
export type LoginResult=LoginResponse|MfaChallenge;

export interface SessionIdentity {
  sub: string;
  role: 'admin'|'user';
  idUser: number;
  exp: number;
}
