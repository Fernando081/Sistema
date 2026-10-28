import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService, AuthUser } from '../auth.service';
import { SessionsComponent } from './sessions.component';
import { MfaComponent } from './mfa.component';
import { PasswordRecoveryComponent } from './password-recovery.component';

@Component({
  selector: 'app-profile', standalone: true,
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSnackBarModule, SessionsComponent, MfaComponent, PasswordRecoveryComponent],
  styles: [`.account-panel{padding:1.25rem;border:1px solid var(--c-border);border-radius:var(--radius-lg);background:var(--c-surface);box-shadow:var(--shadow-xs);color:var(--c-text)}.muted{color:var(--c-text-3)}`],
  template: `
    <section class="max-w-xl space-y-5">
      <h2 class="sr-only">Mi cuenta</h2>
      @if (profile(); as user) { <p>{{user.username}} · {{user.role === 'admin' ? 'Administrador' : 'Operador'}}</p> }
      <form [formGroup]="form" (ngSubmit)="save()" class="account-panel flex flex-col gap-3">
        <h2 class="text-base font-semibold">Cambiar contraseña</h2>
        <mat-form-field appearance="outline"><mat-label>Contraseña actual</mat-label><input matInput type="password" formControlName="currentPassword" autocomplete="current-password"></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Nueva contraseña</mat-label><input matInput type="password" formControlName="newPassword" autocomplete="new-password"><mat-hint>Mínimo 10 caracteres.</mat-hint></mat-form-field>
        <mat-form-field appearance="outline"><mat-label>Repetir nueva contraseña</mat-label><input matInput type="password" formControlName="confirmation" autocomplete="new-password"></mat-form-field>
        <p class="text-sm muted">Al guardar se cerrarán tus sesiones y podrás entrar con la nueva contraseña.</p>
        <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">{{busy() ? 'Guardando…' : 'Actualizar contraseña'}}</button>
      </form>
      <app-account-mfa />
      <app-password-recovery-settings />
      <app-account-sessions />
    </section>`,
})
export class ProfileComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  readonly profile = signal<AuthUser | null>(null);
  readonly busy = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(10)]],
    confirmation: ['', Validators.required],
  });
  ngOnInit(): void { this.auth.getProfile().subscribe({ next: user => this.profile.set(user), error: () => {} }); }
  save(): void {
    if (this.busy() || this.form.invalid) return;
    const {currentPassword, newPassword, confirmation} = this.form.getRawValue();
    if (newPassword !== confirmation) { this.snack.open('Las contraseñas nuevas no coinciden.', 'Cerrar'); return; }
    if (new TextEncoder().encode(newPassword).length > 72) { this.snack.open('La contraseña supera el máximo de 72 bytes.', 'Cerrar'); return; }
    this.busy.set(true);
    this.auth.changePassword(currentPassword, newPassword).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => { this.form.reset(); this.auth.clearSession(); this.router.navigate(['/login']); this.snack.open('Contraseña actualizada. Inicia sesión nuevamente.', 'Cerrar'); }, error: () => {},
    });
  }
}
