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
      const part = token.split('.')[1];
      // Convert base64url to standard base64 before decoding
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (part.length % 4)) % 4);
      const payload = JSON.parse(atob(b64));
      return payload;
    } catch (err) {
      console.warn('Failed to decode token payload', err);
      return null;
    }
  }
}
