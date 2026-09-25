import { inject } from '@angular/core';
import { CanActivateFn, Router, ActivatedRouteSnapshot } from '@angular/router';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = (route: ActivatedRouteSnapshot, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    const expectedRoles = route.data['roles'] as Array<string>;
    if (expectedRoles) {
      const decoded = authService.getDecodedToken();
      if (decoded && expectedRoles.includes(decoded.role || '')) {
        return true;
      }
      return router.createUrlTree(['/venta']);
    }
    return true;
  }

  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
