import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { isApiUrl } from '../shared/api-url';
import { NotificationService } from '../shared/notification.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);
  const router = inject(Router);
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (!isApiUrl(req.url)) return throwError(() => error);
      const isLoginRequest = new URL(req.url, window.location.origin).pathname.endsWith('/auth/login');
      const serverMessage = error.error?.message;
      const message = Array.isArray(serverMessage) ? serverMessage.join('. ') :
        typeof serverMessage === 'string' ? serverMessage : 'Ocurrió un error al procesar la solicitud.';

      if (error.status === 401) {
        if (isLoginRequest) {
          notifications.show(message, 4500);
        } else {
          authService.clearSession();
          router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
          notifications.show('Tu sesión expiró. Inicia sesión nuevamente.', 4000);
        }
      } else if (error.status >= 400) {
        notifications.show(message, 4500);
      } else if (error.status === 0) {
        notifications.show(
          'No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentar.',
          5000,
        );
      }

      return throwError(() => error);
    }),
  );
};
