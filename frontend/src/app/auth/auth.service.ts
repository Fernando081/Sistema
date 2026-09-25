import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { LoginRequest, LoginResponse, DecodedToken } from './auth.interface';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = `${environment.apiBaseUrl}/auth`;
  private readonly tokenKey = 'access_token';

  constructor(private readonly http: HttpClient) {}

  login(payload: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/login`, payload).pipe(
      tap((response) => localStorage.setItem(this.tokenKey, response.access_token)),
    );
  }

  logout(): void {
    if (this.getToken()) this.http.post(`${this.apiUrl}/logout`, {}).subscribe({ error: () => {} });
    this.clearSession();
  }

  clearSession(): void {
    localStorage.removeItem(this.tokenKey);
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  isAuthenticated(): boolean {
    const decoded = this.getDecodedToken();
    if (!decoded || typeof decoded.exp !== 'number' || decoded.exp * 1000 <= Date.now()) {
      this.clearSession();
      return false;
    }
    return true;
  }

  getDecodedToken(): DecodedToken | null {
    const token = this.getToken();
    if (!token) return null;
    const segments = token.split('.');
    if (segments.length !== 3) return null;
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    try {
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const jsonString = new TextDecoder('utf-8').decode(bytes);
      const parsed = JSON.parse(jsonString);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as DecodedToken : null;
    } catch {
      return null;
    }
  }

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
  updateUserPermissions(id:number,permissions:Array<{permissionCode:string;granted:boolean}>){return this.http.put(`${this.apiUrl}/users/${id}/permissions`,{permissions})}

  changePassword(currentPassword: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/password`, { currentPassword, newPassword });
  }
}

export interface PermissionSetting {permissionCode:string;description:string;granted:boolean;overridden:boolean}

export interface AuthUser {
  idUser: number;
  username: string;
  role: 'admin' | 'user';
  isActive: boolean;
}
