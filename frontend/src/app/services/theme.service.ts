import { Injectable, signal, effect } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  isDarkMode = signal<boolean>(false);

  constructor() {
    this.initTheme();

    effect(() => {
      const isDark = this.isDarkMode();
      if (isDark) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      }
    });
  }

  toggleTheme(): void {
    this.isDarkMode.update((v) => !v);
  }

  private initTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    let prefersDark = false;

    if (savedTheme === 'dark') {
      prefersDark = true;
    } else if (savedTheme === 'light') {
      prefersDark = false;
    } else {
      // Fallback to system preference if no localStorage value
      prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    
    this.isDarkMode.set(prefersDark);
    if (prefersDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }
}
