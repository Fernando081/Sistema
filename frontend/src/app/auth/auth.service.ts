import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { LoginRequest, LoginResponse } from './auth.interface';

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
    localStorage.removeItem(this.tokenKey);
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  isAuthenticated(): boolean {
    return Boolean(this.getToken());
  }

  getDecodedToken(): { sub?: string; role?: string } | null {
    const token = this.getToken();
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }
      const payload = parts[1];
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const paddingNeeded = base64.length % 4;
      const paddedBase64 =
        paddingNeeded === 0
          ? base64
          : paddingNeeded === 2
          ? base64 + '=='
          : paddingNeeded === 3
          ? base64 + '='
          : base64;
      return JSON.parse(atob(paddedBase64)) as { sub?: string; role?: string };
    } catch {
      return null;
    }
  }
}
