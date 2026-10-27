import { Routes } from '@angular/router';

export const ROOT_ROUTES: Routes = [
  {path:'portal/activar',loadComponent:()=>import('./portal/portal-cliente.component').then(m=>m.PortalClienteComponent)},
  {path:'portal',loadComponent:()=>import('./portal/portal-cliente.component').then(m=>m.PortalClienteComponent)},
  {path:'cotizaciones/responder',loadComponent:()=>import('./cotizacion/versiones/cotizacion-respuesta.component').then(m=>m.CotizacionRespuestaComponent)},
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
