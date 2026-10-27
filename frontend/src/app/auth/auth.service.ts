import { Injectable } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { LoginRequest, LoginResponse, LoginResult, SessionIdentity } from './auth.interface';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${environment.apiBaseUrl}/auth`;
  private identity: SessionIdentity|null=null;
  private restoring?: Observable<boolean>;
  private revision=0;

  constructor(private readonly http: HttpClient) { this.removeLegacyToken(); }

  login(payload: LoginRequest): Observable<LoginResult> {
    this.clearSession();const revision=this.revision;
    return this.http.post<LoginResult>(`${this.apiUrl}/login`, payload).pipe(
      tap(response=>{if(revision!==this.revision)throw new Error('El inicio de sesión fue cancelado');if(!('mfaRequired' in response))this.acceptState(response);}),
    );
  }

  completeMfa(challenge:string,code:string):Observable<LoginResponse>{
    const revision=this.revision;
    return this.http.post<LoginResponse>(`${this.apiUrl}/mfa/login`,{challenge,code}).pipe(tap(response=>{
      if(revision!==this.revision)throw new Error('El inicio de sesión fue cancelado');this.acceptState(response);
    }));
  }
  getMfaStatus(){return this.http.get<{enabled:boolean;available:boolean;recoveryCodesRemaining:number}>(`${this.apiUrl}/mfa/status`);}
  setupMfa(currentPassword:string){return this.http.post<{secret:string;issuer:string;account:string;expiresIn:number}>(`${this.apiUrl}/mfa/setup`,{currentPassword},{context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true)});}
  confirmMfa(code:string){return this.http.post<{recoveryCodes:string[]}>(`${this.apiUrl}/mfa/confirm`,{code},{context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true)});}
  disableMfa(currentPassword:string,code:string){return this.http.post(`${this.apiUrl}/mfa/disable`,{currentPassword,code},{context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true)});}

  logout(): void {
    if (this.identity) this.http.post(`${this.apiUrl}/logout`, {}).subscribe({ error: () => {} });
    this.clearSession();
  }

  clearSession(): void {
    this.identity=null;
    this.revision++;
    this.restoring=undefined;
    this.removeLegacyToken();
  }

  isAuthenticated(): boolean {
    if(!this.identity)return false;
    if (this.identity.exp * 1000 <= Date.now()) {
      this.clearSession();
      return false;
    }
    return true;
  }

  getSessionIdentity(): SessionIdentity|null { return this.isAuthenticated()?this.identity:null; }

  ensureSession(): Observable<boolean> {
    if(this.isAuthenticated())return of(true);
    if(!this.restoring){const revision=this.revision;this.restoring=this.http.get<LoginResponse>(`${this.apiUrl}/browser-state`).pipe(
      map(response=>{if(revision!==this.revision)return false;this.acceptState(response);return true;}),
      catchError(()=>{if(revision===this.revision)this.clearSession();return of(false);}),
      finalize(()=>{if(revision===this.revision)this.restoring=undefined;}),shareReplay({bufferSize:1,refCount:false}),
    );}
    return this.restoring;
  }

  private acceptState(response: LoginResponse) {
    const user=response.profile;
    if(!user||!Number.isSafeInteger(user.idUser)||user.idUser<=0||!user.isActive||
      !['admin','user'].includes(user.role)||typeof user.username!=='string'||!Number.isSafeInteger(response.expiresAt)||response.expiresAt*1000<=Date.now()){
      this.clearSession();throw new Error('Respuesta de sesión inválida');
    }
    this.identity={idUser:user.idUser,sub:user.username,role:user.role,exp:response.expiresAt};
    this.removeLegacyToken();
  }

  private removeLegacyToken() {for(const key of ['localStorage','sessionStorage'] as const)try{window[key].removeItem('access_token');}catch{/* Cookie HttpOnly no depende de Web Storage. */}}

  getProfile(): Observable<AuthUser> {
    return this.http.get<AuthUser>(`${this.apiUrl}/me`);
  }

  getUsers(): Observable<AuthUser[]> {
    return this.http.get<AuthUser[]>(`${this.apiUrl}/users`);
  }

  createUser(payload: { username: string; password: string; role: 'admin' | 'user' }): Observable<AuthUser> {
    return this.http.post<AuthUser>(`${this.apiUrl}/register`, payload);
  }

  updateUser(id: number, payload: Partial<Pick<AuthUser, 'role' | 'isActive'>>): Observable<AuthUser> {
    return this.http.patch<AuthUser>(`${this.apiUrl}/users/${id}`, payload);
  }

  getUserPermissions(id:number):Observable<PermissionSetting[]>{return this.http.get<PermissionSetting[]>(`${this.apiUrl}/users/${id}/permissions`)}
  updateUserPermissions(id:number,permissions:Array<{permissionCode:string;granted:boolean}>,accessVersion:number){return this.http.put(`${this.apiUrl}/users/${id}/permissions`,{permissions,accessVersion})}
  getPermissionCatalog() { return this.http.get<PermissionCatalogEntry[]>(`${this.apiUrl}/permission-catalog`); }
  getAccessProfiles() { return this.http.get<AccessProfile[]>(`${this.apiUrl}/access-profiles`); }
  createAccessProfile(body: AccessProfileInput) { return this.http.post(`${this.apiUrl}/access-profiles`,body); }
  updateAccessProfile(id: number,body: AccessProfileInput & {version: number}) { return this.http.put(`${this.apiUrl}/access-profiles/${id}`,body); }
  deleteAccessProfile(id: number,version: number) { return this.http.delete(`${this.apiUrl}/access-profiles/${id}`,{body:{version}}); }
  assignAccessProfile(id: number,idProfile: number | null,accessVersion: number) {
    return this.http.put(`${this.apiUrl}/users/${id}/access-profile`,{idProfile,accessVersion});
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/password`, { currentPassword, newPassword });
  }

  getSessions() { return this.http.get<AuthSession[]>(`${this.apiUrl}/sessions`); }
  revokeSession(id: string) { return this.http.post<{message:string;current:boolean}>(`${this.apiUrl}/sessions/${id}/revoke`,{}); }
  logoutAll() { return this.http.post<{message:string}>(`${this.apiUrl}/logout-all`,{}); }
}

export interface AuthSession {
  idSession: string;
  clientLabel: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export interface PermissionCatalogEntry { permissionCode: string; description: string }
export interface PermissionSetting extends PermissionCatalogEntry {granted:boolean;overridden:boolean;inheritedGranted:boolean;accessVersion:number}
export interface AccessProfileInput { name: string; description: string; permissions: string[] }
export interface AccessProfile extends AccessProfileInput { idProfile: number; version: number; assignedUsers: number }

export interface AuthUser {
  idUser: number;
  username: string;
  role: 'admin' | 'user';
  isActive: boolean;
  idProfile?: number | null;
  profileName?: string | null;
  accessVersion?: number;
  overrideCount?: number;
}
