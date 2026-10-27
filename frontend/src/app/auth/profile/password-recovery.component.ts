import { Component, HostListener, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { finalize } from 'rxjs';
import { PasswordRecoveryService, RecoveryStatus } from '../password-recovery.service';

@Component({
  selector:'app-password-recovery-settings',standalone:true,imports:[DatePipe,ReactiveFormsModule,MatButtonModule,MatFormFieldModule,MatInputModule],
  styles:[`:host{display:block}section{padding:1.25rem;border:1px solid var(--wrap-border);border-radius:.75rem;background:var(--wrap-card-bg);color:var(--wrap-text-title)}h2{font-size:1.125rem;font-weight:600;color:var(--wrap-text-title)}p{margin:.75rem 0;color:var(--wrap-text-muted)}form{display:flex;flex-direction:column;gap:.75rem}code{display:block;overflow-wrap:anywhere;user-select:all;padding:.75rem;border:1px solid var(--wrap-border);border-radius:.5rem}button:disabled{opacity:.55}button{align-self:start;white-space:normal;height:auto!important;min-height:2.5rem}.error{color:var(--wrap-text-title);border-inline-start:3px solid #dc2626;padding-inline-start:.75rem}`],
  template:`<section aria-labelledby="recovery-title"><h2 id="recovery-title">Recuperar acceso a tu cuenta</h2>
    <p>Prepara una clave para recuperar tu contraseña si la olvidas. Guárdala fuera de este equipo. Es distinta de los códigos de respaldo del autenticador.</p>
    @if(error()){<p role="alert" class="error">{{error()}}</p>}
    @if(message()){<p role="status">{{message()}}</p>}
    @if(pending();as key){
      <p>Guarda esta clave de recuperación. Debes confirmarla antes de diez minutos; después podrás usarla una sola vez durante un año. La clave anterior se conserva hasta confirmar esta.</p>
      <code aria-label="Clave de recuperación pendiente">{{key}}</code>
      <form [formGroup]="confirmForm" (ngSubmit)="confirm()">
        <mat-form-field><mat-label>Repite la clave que guardaste</mat-label><input matInput type="password" formControlName="recoveryKey" maxlength="51" autocomplete="off" spellcheck="false"></mat-form-field>
        <button mat-flat-button [disabled]="busy()||confirmForm.invalid">Confirmar que guardé mi clave</button>
        <button mat-button type="button" [disabled]="busy()" (click)="cancel()">Descartar configuración pendiente</button>
      </form>
    } @else if(state();as status){
      <p>{{status.configured ? 'Clave de recuperación configurada y vigente.' : 'No tienes una clave de recuperación vigente.'}}</p>
      @if(status.configured){<p>Vence: {{status.expiresAt | date:'mediumDate'}}. Usarla o cambiar tu contraseña la invalida; puedes reemplazarla aquí.</p>}
      <form [formGroup]="proofForm" (ngSubmit)="begin()">
        <mat-form-field><mat-label>Contraseña actual</mat-label><input matInput type="password" aria-label="Contraseña actual para recuperar acceso" formControlName="currentPassword" autocomplete="current-password"></mat-form-field>
        <mat-form-field><mat-label>Código MFA, si está activado</mat-label><input matInput formControlName="code" autocomplete="one-time-code" maxlength="35"></mat-form-field>
        <p>Con verificación en dos pasos, usa un código nuevo del autenticador o un respaldo disponible. Un código ya usado no funciona de nuevo.</p>
        <button mat-flat-button [disabled]="busy()||proofForm.invalid">{{busy() ? 'Procesando…' : status.configured ? 'Reemplazar clave de recuperación' : 'Generar clave de recuperación'}}</button>
        @if(status.configured||status.pending){<button mat-button type="button" [disabled]="busy()||proofForm.invalid" (click)="revoke()">Retirar clave de recuperación</button>}
      </form>
    } @else {
      <p>{{busy() ? 'Consultando recuperación…' : 'No se pudo consultar la recuperación.'}}</p><button mat-button type="button" [disabled]="busy()" (click)="load()">Reintentar</button>
    }
  </section>`,
})
export class PasswordRecoveryComponent implements OnInit {
  private readonly api=inject(PasswordRecoveryService);private readonly fb=inject(FormBuilder);
  readonly state=signal<RecoveryStatus|null>(null);readonly pending=signal<string|null>(null);readonly busy=signal(false);readonly error=signal('');readonly message=signal('');
  readonly proofForm=this.fb.nonNullable.group({currentPassword:['',Validators.required],code:['',Validators.pattern(/^(?:\d{6}|[a-fA-F0-9]{8}(?:-?[a-fA-F0-9]{8}){3})?$/)]});
  readonly confirmForm=this.fb.nonNullable.group({recoveryKey:['',[Validators.required,Validators.pattern(/^RTT-PWD-[A-Za-z0-9_-]{43}$/)]]});
  ngOnInit(){this.load();}
  load(){if(this.busy())return;this.busy.set(true);this.error.set('');this.api.status().pipe(finalize(()=>this.busy.set(false))).subscribe({next:value=>this.state.set(value),error:()=>this.error.set('No se pudo consultar la recuperación de cuenta.')});}
  begin(){if(this.busy()||this.proofForm.invalid)return;this.start();const {currentPassword,code}=this.proofForm.getRawValue();
    this.api.begin(currentPassword,code).pipe(finalize(()=>this.busy.set(false))).subscribe({next:value=>{this.pending.set(value.recoveryKey);this.proofForm.reset();},error:error=>this.fail(error)});}
  confirm(){if(this.busy()||this.confirmForm.invalid)return;this.start();this.api.confirm(this.confirmForm.getRawValue().recoveryKey).pipe(finalize(()=>{this.busy.set(false);if(!this.pending())this.load();})).subscribe({
    next:value=>{this.pending.set(null);this.confirmForm.reset();this.message.set(value.message);},error:error=>this.fail(error),
  });}
  revoke(){if(this.busy()||this.proofForm.invalid)return;this.start();let updated=false;const {currentPassword,code}=this.proofForm.getRawValue();this.api.revoke(currentPassword,code).pipe(finalize(()=>{this.busy.set(false);if(updated)this.load();})).subscribe({next:value=>{updated=true;this.proofForm.reset();this.message.set(value.message);},error:error=>this.fail(error)});}
  cancel(){this.pending.set(null);this.confirmForm.reset();this.proofForm.reset();this.error.set('');this.load();}
  @HostListener('window:beforeunload',['$event']) protect(event:BeforeUnloadEvent){if(this.pending())event.preventDefault();}
  private start(){this.busy.set(true);this.error.set('');this.message.set('');}
  private fail(error:unknown){this.proofForm.reset();this.confirmForm.reset();this.error.set(error instanceof HttpErrorResponse&&typeof error.error?.message==='string'?error.error.message:'No se pudo completar la operación.');}
}
