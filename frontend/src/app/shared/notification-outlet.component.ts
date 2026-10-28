import { Component, inject } from '@angular/core';
import { NotificationService } from './notification.service';

@Component({
  selector: 'app-notification-outlet',
  standalone: true,
  template: `
    @if (notifications.current(); as notification) {
      <div
        class="app-notification"
        [class.app-notification-info]="notification.kind === 'info'"
        role="alert"
        aria-live="assertive"
      >
        <span>{{ notification.message }}</span>
        <button type="button" (click)="notifications.dismiss()" aria-label="Cerrar aviso">×</button>
      </div>
    }
  `,
  styles: `
    .app-notification {
      position: fixed;
      z-index: 1100;
      top: 1rem;
      right: 1rem;
      display: flex;
      max-width: min(28rem, calc(100vw - 2rem));
      align-items: center;
      gap: 1rem;
      padding: 0.85rem 1rem;
      border-radius: 0.75rem;
      background: #2f3033;
      color: #fff;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.24);
      font:
        500 0.9rem/1.35 'Segoe UI',
        Arial,
        sans-serif;
    }
    .app-notification-info {
      background: #075985;
    }
    button {
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 1.4rem;
      line-height: 1;
    }
  `,
})
export class NotificationOutletComponent {
  readonly notifications = inject(NotificationService);
}
