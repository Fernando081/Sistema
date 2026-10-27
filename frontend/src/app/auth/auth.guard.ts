import { inject } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot } from '@angular/router';
import { AuthService } from './auth.service';
import { map } from 'rxjs';

export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.ensureSession().pipe(map(authenticated=>{
   if (authenticated) {
    const expectedRoles = route.data['roles'] as Array<string>;
    if (expectedRoles) {
      const decoded = authService.getSessionIdentity();
      if (decoded && expectedRoles.includes(decoded.role || '')) {
        return true;
      }
      return router.createUrlTree(['/venta']);
    }
    return true;
  }

   return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }));
};
