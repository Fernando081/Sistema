import { Routes } from '@angular/router';

export const ROOT_ROUTES: Routes = [
  {
    path: 'login',
    loadChildren: () =>
      import('./auth/login/login.routes').then((module) => module.LOGIN_ROUTES),
  },
  {
    path: '',
    loadChildren: () =>
      import('./app.routes').then((module) => module.AUTHENTICATED_ROUTES),
  },
];
