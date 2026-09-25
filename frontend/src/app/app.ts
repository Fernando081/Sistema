import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NotificationOutletComponent } from './shared/notification-outlet.component';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NotificationOutletComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  // Instantiate the theme at application startup so login and authenticated pages stay consistent.
  readonly themeService = inject(ThemeService);
}
