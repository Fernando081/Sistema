import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { finalize } from 'rxjs';
import { PasswordRecoveryService } from '../password-recovery.service';

@Component({
  selector:'app-recover-password',standalone:true,imports:[ReactiveFormsModule,RouterLink,MatButtonModule,MatFormFieldModule,MatInputModule],
  styles:[`:host{display:block;min-height:100vh;background:var(--wrap-bg);color:var(--wrap-text-title);padding:1.25rem}main{max-width:34rem;margin:2rem auto;padding:1.5rem;border-radius:1rem;background:var(--wrap-card-bg);border:1px solid var(--wrap-border)}h1{font-size:1.5rem;font-weight:700;color:var(--wrap-text-title)}p{color:var(--wrap-text-muted);margin:1rem 0}form{display:flex;flex-direction:column;gap:.75rem}button:disabled{opacity:.55}button,a{align-self:start;white-space:normal;height:auto!important;min-height:2.5rem}.error{color:var(--wrap-text-title);border-inline-start:3px solid #dc2626;padding-inline-start:.75rem}`],
  template:`<main><h1>Recuperar contraseña</h1>
    @if(success()){
      <p role="status">{{success()}}</p><p>Se cerraron tus sesiones y se consumió tu clave. La verificación en dos pasos sigue activa si la tenías configurada.</p>
      <a mat-flat-button routerLink="/login">Iniciar sesión con la nueva contraseña</a>
    } @else {
      <p>Necesitas la clave de recuperación que guardaste previamente desde Mi cuenta. Si tienes verificación en dos pasos, también necesitas un código del autenticador o un respaldo disponible.</p>
      <p>Si no guardaste una clave o perdiste todos tus factores, contacta personalmente al propietario para verificar tu identidad. Esta pantalla no envía correos ni elimina MFA.</p>
      @if(error()){<p role="alert" class="error">{{error()}}</p>}
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field><mat-label>Usuario de la cuenta</mat-label><input matInput formControlName="username" autocomplete="username" maxlength="100"></mat-form-field>
        <mat-form-field><mat-label>Clave de recuperación</mat-label><input matInput type="password" aria-label="Clave de recuperación de contraseña" formControlName="recoveryKey" autocomplete="off" maxlength="51" spellcheck="false"></mat-form-field>
        <mat-form-field><mat-label>Nueva contraseña</mat-label><input matInput type="password" aria-label="Nueva contraseña de la cuenta" formControlName="newPassword" autocomplete="new-password" maxlength="72"><mat-hint>Mínimo diez caracteres; máximo 72 bytes.</mat-hint></mat-form-field>
        <mat-form-field><mat-label>Repetir contraseña</mat-label><input matInput type="password" aria-label="Repetir nueva contraseña de la cuenta" formControlName="confirmation" autocomplete="new-password" maxlength="72"></mat-form-field>
        <mat-form-field><mat-label>Código de segundo factor</mat-label><input matInput aria-label="Código MFA para recuperar, si está activado" formControlName="code" autocomplete="one-time-code" maxlength="35"></mat-form-field>
        <button mat-flat-button [disabled]="busy()||form.invalid">{{busy() ? 'Recuperando…' : 'Recuperar mi contraseña'}}</button>
        <a mat-button routerLink="/login">Volver al inicio de sesión</a>
      </form>
    }
  </main>`,
})
export class RecoverPasswordComponent {
  private readonly api=inject(PasswordRecoveryService);private readonly fb=inject(FormBuilder);
  readonly busy=signal(false);readonly error=signal('');readonly success=signal('');
  readonly form=this.fb.nonNullable.group({username:['',Validators.required],recoveryKey:['',[Validators.required,Validators.pattern(/^RTT-PWD-[A-Za-z0-9_-]{43}$/)]],
    newPassword:['',[Validators.required,Validators.minLength(10)]],confirmation:['',Validators.required],code:['',Validators.pattern(/^(?:\d{6}|[a-fA-F0-9]{8}(?:-?[a-fA-F0-9]{8}){3})?$/)]});
  submit(){if(this.busy()||this.form.invalid)return;const value=this.form.getRawValue();this.error.set('');
    if(value.newPassword!==value.confirmation){this.error.set('Las contraseñas nuevas no coinciden.');return;}
    if(new TextEncoder().encode(value.newPassword).length>72){this.error.set('La contraseña supera el máximo de72 bytes.');return;}
    this.busy.set(true);const {code,...rest}=value;
    this.api.recover({...rest,...(code?{code}:{})}).pipe(finalize(()=>this.busy.set(false))).subscribe({next:result=>{this.form.reset();this.success.set(result.message);},error:error=>{
      this.form.patchValue({newPassword:'',confirmation:'',code:''});this.error.set(error instanceof HttpErrorResponse&&typeof error.error?.message==='string'?error.error.message:'No se pudo recuperar la cuenta. Intenta nuevamente.');
    }});
  }
}
