import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { isApiUrl } from '../shared/api-url';
import { NotificationService } from '../shared/notification.service';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);
  const router = inject(Router);
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (!isApiUrl(req.url)) return throwError(() => error);
      const path=new URL(req.url,window.location.origin).pathname;
      // El portal presenta sus errores y caducidad; nunca cierra la sesión del personal.
      if(path==='/api/v1/portal'||path.startsWith('/api/v1/portal/'))return throwError(()=>error);
      const isLoginRequest = path.endsWith('/auth/login')||path.endsWith('/auth/mfa/login');
      const serverMessage = error.error?.message;
      const message = Array.isArray(serverMessage) ? serverMessage.join('. ') :
        typeof serverMessage === 'string' ? serverMessage : 'Ocurrió un error al procesar la solicitud.';

      if (error.status === 401) {
        if(new URL(req.url,window.location.origin).pathname.endsWith('/auth/browser-state'))return throwError(()=>error);
        if (isLoginRequest) {
          notifications.show(message, 4500);
        } else {
          authService.clearSession();
          router.navigate(['/login'], { queryParams: { returnUrl: router.url } });
          notifications.show('Tu sesión expiró. Inicia sesión nuevamente.', 4000);
        }
      } else if (!req.context.get(LOCAL_ERROR_FEEDBACK) && error.status >= 400) {
        notifications.show(message, 4500);
      } else if (!req.context.get(LOCAL_ERROR_FEEDBACK) && error.status === 0) {
        notifications.show(
          'No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentar.',
          5000,
        );
      }

      return throwError(() => error);
    }),
  );
};
