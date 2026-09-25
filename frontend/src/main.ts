// frontend/src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

if (environment.production && 'serviceWorker' in navigator) {
  const registerServiceWorker = () => {
    navigator.serviceWorker.register('/ngsw-worker.js').catch((error: unknown) => {
      console.error('No fue posible registrar el modo sin conexión.', error);
    });
  };

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(registerServiceWorker, { timeout: 30_000 });
  } else {
    setTimeout(registerServiceWorker, 30_000);
  }
}
