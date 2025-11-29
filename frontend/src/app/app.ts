// frontend/src/app/app.ts

import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav'; // <-- NUEVO
import { MatListModule } from '@angular/material/list';     // <-- NUEVO

@Component({
  selector: 'app-root',
  standalone: true,
  // Añadimos los nuevos módulos al array 'imports'
  imports: [
    CommonModule, 
    RouterOutlet,
    RouterLink,
    MatToolbarModule,
    MatIconModule,
    MatButtonModule,
    MatSidenavModule, // <-- NUEVO
    MatListModule      // <-- NUEVO
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  title = 'frontend';
}