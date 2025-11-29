// frontend/src/app/app.config.ts

import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideHttpClient } from '@angular/common/http';
import { MAT_DATE_LOCALE } from '@angular/material/core';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes), // Habilita las rutas que definiste
    provideAnimations(), // Habilita Angular Material
    provideHttpClient(), // Habilita el servicio para llamar a tu backend
    { provide: MAT_DATE_LOCALE, useValue: 'es-MX' } // Opcional: Fechas en español
  ]
};