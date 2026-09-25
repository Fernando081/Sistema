import { Injectable, signal } from '@angular/core';

export interface AppNotification {
  id: number;
  message: string;
  kind: 'error' | 'info';
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly current = signal<AppNotification | null>(null);
  private sequence = 0;
  private dismissTimer?: ReturnType<typeof setTimeout>;

  show(message: string, duration = 4500, kind: AppNotification['kind'] = 'error'): void {
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    const notification = { id: ++this.sequence, message, kind };
    this.current.set(notification);
    this.dismissTimer = setTimeout(() => {
      if (this.current()?.id === notification.id) this.current.set(null);
    }, duration);
  }

  dismiss(): void {
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.current.set(null);
  }
}
