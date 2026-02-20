// frontend/src/app/app.ts

import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { AsyncPipe, CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, shareReplay } from 'rxjs';
import { AuthService } from './auth/auth.service';

type AuthUser = {
  sub?: string;
  role?: string;
  // Optional JWT timestamp fields, aligned with backend JwtPayload
  iat?: number;
  exp?: number;
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatSidenavModule,
    MatListModule,
    AsyncPipe,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly breakpointObserver = inject(BreakpointObserver);

  isLoginRoute = false;
  user: AuthUser | null = null;
  readonly isHandset$ = this.breakpointObserver.observe(Breakpoints.Handset).pipe(
    map((result) => result.matches),
    shareReplay(1),
  );

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {
    this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe(() => {
        this.isLoginRoute = this.router.url.startsWith('/login');
        this.user = this.getUserFromToken();
      });
    this.isLoginRoute = this.router.url.startsWith('/login');
    this.user = this.getUserFromToken();
  }

  logout(): void {
    this.authService.logout();
    this.user = null;
    this.router.navigate(['/login']);
  }

  private getUserFromToken(): AuthUser | null {
    const token = this.authService.getToken();
    if (!token) {
      return null;
    }

    const segments = token.split('.');
    if (segments.length !== 3) {
      return null;
    }

    const payload = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');

    try {
      const decoded = atob(padded);
      const parsed = JSON.parse(decoded) as AuthUser;
      return parsed;
    } catch {
      return null;
    }
  }
}
