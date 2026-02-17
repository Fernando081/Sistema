import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const snackBar = inject(MatSnackBar);
  const router = inject(Router);
  const authService = inject(AuthService);

  const isLoginRequest = req.url.includes('/auth/login');

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        if (isLoginRequest) {
          const message = error.error?.message || 'Credenciales inválidas.';
          snackBar.open(message, 'Cerrar', { duration: 4500 });
        } else {
          authService.logout();
          router.navigate(['/login']);
          snackBar.open('Tu sesión expiró. Inicia sesión nuevamente.', 'Cerrar', { duration: 4000 });
        }
      } else if (error.status >= 400) {
        const message = error.error?.message || 'Ocurrió un error al procesar la solicitud.';
        snackBar.open(message, 'Cerrar', { duration: 4500 });
      }

      return throwError(() => error);
    }),
  );
};
