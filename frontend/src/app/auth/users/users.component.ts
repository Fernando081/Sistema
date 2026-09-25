import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { finalize } from 'rxjs';
import { AuthService, AuthUser, PermissionSetting } from '../auth.service';
import { ConfirmService } from '../../shared/confirm.service';

@Component({
  selector: 'app-users', standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule, MatSnackBarModule],
  template: `
    <section class="space-y-6">
      <div><h1 class="text-2xl font-semibold">Usuarios y acceso</h1>
        <p class="text-slate-500">Crea cuentas individuales y administra quién puede operar el negocio.</p></div>
      <form [formGroup]="form" (ngSubmit)="create()" class="bg-white dark:bg-slate-900 p-5 rounded-xl flex flex-wrap gap-4 items-start">
        <mat-form-field><mat-label>Usuario</mat-label><input matInput formControlName="username" autocomplete="off" maxlength="100"><mat-error>Entre 3 y 100 caracteres, sin espacios.</mat-error></mat-form-field>
        <mat-form-field><mat-label>Contraseña inicial</mat-label><input matInput type="password" formControlName="password" autocomplete="new-password"><mat-hint>Mínimo 10 caracteres.</mat-hint></mat-form-field>
        <mat-form-field><mat-label>Permisos</mat-label><mat-select formControlName="role"><mat-option value="user">Operador</mat-option><mat-option value="admin">Administrador</mat-option></mat-select></mat-form-field>
        <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">Crear usuario</button>
      </form>
      <p class="text-sm text-slate-500">Cambiar permisos o desactivar una cuenta cierra sus sesiones. Las operaciones quedan asociadas a su usuario.</p>
      <div class="overflow-x-auto">
        <table mat-table [dataSource]="users()" class="w-full">
          <ng-container matColumnDef="username"><th mat-header-cell *matHeaderCellDef>Usuario</th><td mat-cell *matCellDef="let u">{{u.username}} {{u.idUser === ownId ? '(tú)' : ''}}</td></ng-container>
          <ng-container matColumnDef="role"><th mat-header-cell *matHeaderCellDef>Permisos</th><td mat-cell *matCellDef="let u">{{u.role === 'admin' ? 'Administrador' : 'Operador'}}</td></ng-container>
          <ng-container matColumnDef="state"><th mat-header-cell *matHeaderCellDef>Estado</th><td mat-cell *matCellDef="let u">{{u.isActive ? 'Activo' : 'Desactivado'}}</td></ng-container>
          <ng-container matColumnDef="actions"><th mat-header-cell *matHeaderCellDef>Acciones</th><td mat-cell *matCellDef="let u">
            <button mat-button [disabled]="busy()" (click)="editPermissions(u)">Permisos detallados</button>
            <button mat-button [disabled]="busy() || u.idUser === ownId" (click)="change(u, {role: u.role === 'admin' ? 'user' : 'admin'})">{{u.role === 'admin' ? 'Hacer operador' : 'Hacer administrador'}}</button>
            <button mat-button [disabled]="busy() || u.idUser === ownId" (click)="change(u, {isActive: !u.isActive})">{{u.isActive ? 'Desactivar' : 'Reactivar'}}</button>
          </td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns;"></tr>
          <tr *matNoDataRow><td colspan="4" class="p-5">{{loading() ? 'Cargando usuarios…' : 'Sin usuarios disponibles.'}}</td></tr>
        </table>
      </div>
      @if(permissionUser();as selected){<section class="permission-editor bg-white dark:bg-slate-900 p-5 rounded-xl"><header><div><h2>Permisos de {{selected.username}}</h2><p>Los cambios se validan también en el backend.</p></div><button mat-button type="button" (click)="permissionUser.set(null)">Cerrar</button></header><div class="permission-grid">@for(permission of permissionSettings();track permission.permissionCode){<label><input type="checkbox" [checked]="permission.granted" (change)="togglePermission(permission,$any($event.target).checked)"><span><strong>{{permission.permissionCode}}</strong><small>{{permission.description}}</small></span></label>}</div><button mat-flat-button type="button" [disabled]="busy()" (click)="savePermissions()">Guardar permisos</button></section>}
    </section>`,
  styles:[`.permission-editor{border:1px solid var(--wrap-border)}.permission-editor header{display:flex;justify-content:space-between;gap:1rem}.permission-editor h2{margin:0}.permission-editor p{color:var(--wrap-text-muted)}.permission-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.6rem;margin:1rem 0}.permission-grid label{display:flex;align-items:flex-start;gap:.6rem;padding:.75rem;border:1px solid var(--wrap-border);border-radius:9px}.permission-grid span{display:flex;flex-direction:column}.permission-grid small{color:var(--wrap-text-muted)}`],
})
export class UsersComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);
  private readonly fb = inject(FormBuilder);
  private readonly confirm = inject(ConfirmService);
  readonly users = signal<AuthUser[]>([]);
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly permissionUser=signal<AuthUser|null>(null);
  readonly permissionSettings=signal<PermissionSetting[]>([]);
  readonly ownId = this.auth.getDecodedToken()?.idUser;
  readonly columns = ['username', 'role', 'state', 'actions'];
  readonly form = this.fb.nonNullable.group({
    username: ['', [Validators.required, Validators.pattern(/^\S{3,100}$/)]],
    password: ['', [Validators.required, Validators.minLength(10)]],
    role: this.fb.nonNullable.control<'admin' | 'user'>('user'),
  });
  ngOnInit(): void { this.load(); }
  load(): void {
    this.loading.set(true);
    this.auth.getUsers().pipe(finalize(() => this.loading.set(false))).subscribe({ next: rows => this.users.set(rows), error: () => {} });
  }
  create(): void {
    if (this.busy() || this.form.invalid) return;
    if (new TextEncoder().encode(this.form.controls.password.value).length > 72) {
      this.snack.open('La contraseña supera el máximo de 72 bytes. Usa una contraseña más corta.', 'Cerrar'); return;
    }
    this.busy.set(true);
    this.auth.createUser(this.form.getRawValue()).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => { this.form.reset({ role: 'user' }); this.load(); this.snack.open('Usuario creado.', 'Cerrar'); }, error: () => {},
    });
  }
  change(user: AuthUser, changes: Partial<Pick<AuthUser, 'role' | 'isActive'>>): void {
    if (this.busy() || user.idUser === this.ownId) return;
    this.confirm.ask({ title: 'Actualizar acceso', message: `Se actualizará el acceso de ${user.username} y se cerrarán sus sesiones actuales.`, confirmLabel: 'Actualizar acceso', tone: 'primary' }).subscribe(confirmed => {
      if (!confirmed) return;
      this.busy.set(true);
      this.auth.updateUser(user.idUser, changes).pipe(finalize(() => this.busy.set(false))).subscribe({
        next: () => { this.load(); this.snack.open('Permisos actualizados.', 'Cerrar'); }, error: () => {},
      });
    });
  }
  editPermissions(user:AuthUser){this.permissionUser.set(user);this.auth.getUserPermissions(user.idUser).subscribe(rows=>this.permissionSettings.set(rows))}
  togglePermission(permission:PermissionSetting,granted:boolean){this.permissionSettings.update(rows=>rows.map(row=>row.permissionCode===permission.permissionCode?{...row,granted,overridden:true}:row))}
  savePermissions(){const user=this.permissionUser();if(!user||this.busy())return;this.busy.set(true);this.auth.updateUserPermissions(user.idUser,this.permissionSettings().map(({permissionCode,granted})=>({permissionCode,granted}))).pipe(finalize(()=>this.busy.set(false))).subscribe(()=>this.snack.open('Permisos detallados actualizados.','Cerrar'))}
}
