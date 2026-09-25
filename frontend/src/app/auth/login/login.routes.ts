import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { Routes } from '@angular/router';

export const LOGIN_ROUTES: Routes = [
  {
    path: '',
    providers: [provideAnimationsAsync()],
    loadComponent: () =>
      import('./login.component').then((module) => module.LoginComponent),
  },
];
