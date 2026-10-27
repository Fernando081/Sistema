import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { Routes } from '@angular/router';

export const LOGIN_ROUTES: Routes = [
  {path:'recuperar',providers:[provideAnimationsAsync()],loadComponent:()=>import('./recover-password.component').then(module=>module.RecoverPasswordComponent)},
  {
    path:'respaldos',providers:[provideAnimationsAsync()],
    canDeactivate:[(component:{canDeactivate:()=>boolean})=>component.canDeactivate()],
    loadComponent:()=>import('./mfa-receipt.component').then(module=>module.MfaReceiptComponent),
  },
  {
    path: '',
    providers: [provideAnimationsAsync()],
    loadComponent: () =>
      import('./login.component').then((module) => module.LoginComponent),
  },
];
