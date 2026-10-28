import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { ConfirmService } from './confirm.service';
import { NotificationService } from './notification.service';
import { TextPromptService } from './text-prompt.service';
import {
  RutaVista,
  VistaGuardada,
  VistasGuardadasService,
  consultaDeVista,
} from '../services/vistas-guardadas.service';

/**
 * U02.2 · Menú "Vistas" de un listado: abre, guarda y elimina combinaciones de filtros propias.
 * Aplicar una vista sólo cambia la URL; el listado ya restaura sus filtros desde ella (Q04.3/Q04.4).
 */
@Component({
  selector: 'app-saved-views',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatMenuModule],
  template: `
    <button
      mat-stroked-button
      type="button"
      [matMenuTriggerFor]="menu"
      aria-label="Vistas guardadas de este listado"
    >
      <mat-icon>bookmarks</mat-icon>{{ activa()?.nombre || 'Vistas' }}
    </button>
    <mat-menu #menu="matMenu" xPosition="before">
      @for (vista of vistas(); track vista.idVista) {
        <button
          mat-menu-item
          type="button"
          (click)="aplicar(vista)"
          [attr.aria-current]="vista === activa() ? 'true' : null"
        >
          <mat-icon>{{ vista === activa() ? 'check' : 'bookmark_border' }}</mat-icon
          ><span>{{ vista.nombre }}</span>
        </button>
      } @empty {
        <p class="saved-views-empty">Aún no tienes vistas en este listado.</p>
      }
      <button mat-menu-item type="button" (click)="guardar()">
        <mat-icon>bookmark_add</mat-icon><span>Guardar filtros actuales…</span>
      </button>
      @if (activa(); as vista) {
        <button mat-menu-item type="button" (click)="eliminar(vista)">
          <mat-icon>delete_outline</mat-icon><span>Eliminar «{{ vista.nombre }}»</span>
        </button>
      }
    </mat-menu>
  `,
  styles: [
    `
      .saved-views-empty {
        margin: 0;
        padding: 12px 16px;
        color: var(--c-text-3);
        font-size: 13px;
        max-width: 240px;
      }
    `,
  ],
})
export class SavedViewsComponent implements OnInit {
  readonly ruta = input.required<RutaVista>();
  private readonly api = inject(VistasGuardadasService);
  private readonly router = inject(Router);
  private readonly prompt = inject(TextPromptService);
  private readonly confirm = inject(ConfirmService);
  private readonly notice = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly vistas = signal<VistaGuardada[]>([]);
  private readonly consultaActual = signal('');
  readonly activa = computed(
    () => this.vistas().find((v) => v.consulta === this.consultaActual()) ?? null,
  );

  ngOnInit(): void {
    this.leerUrl();
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.leerUrl());
    this.cargar();
  }

  private leerUrl() {
    this.consultaActual.set(consultaDeVista(this.router.url.split('?')[1] ?? ''));
  }
  private cargar() {
    this.api.list(this.ruta()).subscribe((vistas) => this.vistas.set(vistas));
  }

  aplicar(vista: VistaGuardada) {
    this.router.navigate([this.ruta()], {
      queryParams: Object.fromEntries(new URLSearchParams(vista.consulta)),
    });
  }

  guardar() {
    this.prompt
      .ask({
        title: 'Guardar vista',
        message:
          'Guarda la búsqueda, filtros, orden y tamaño de página actuales. Si usas un nombre que ya tienes, se actualiza esa vista.',
        label: 'Nombre de la vista',
        confirmLabel: 'Guardar',
        maxLength: 60,
      })
      .subscribe((nombre) => {
        if (!nombre) return;
        this.api.save(this.ruta(), nombre, this.consultaActual()).subscribe((vista) => {
          this.vistas.update((items) =>
            [...items.filter((v) => v.idVista !== vista.idVista), vista].sort((a, b) =>
              a.nombre.localeCompare(b.nombre, 'es'),
            ),
          );
          this.notice.show(`Vista "${vista.nombre}" guardada`, 3000, 'info');
        });
      });
  }

  eliminar(vista: VistaGuardada) {
    this.confirm
      .ask({
        title: 'Eliminar vista',
        message: `Se eliminará la vista "${vista.nombre}". Los datos del listado no cambian.`,
        confirmLabel: 'Eliminar',
        tone: 'danger',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.api.remove(vista.idVista).subscribe(() => {
          this.vistas.update((items) => items.filter((v) => v.idVista !== vista.idVista));
          this.notice.show(`Vista "${vista.nombre}" eliminada`, 3000, 'info');
        });
      });
  }
}
