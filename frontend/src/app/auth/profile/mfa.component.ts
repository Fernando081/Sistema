import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../auth.service';
import { MfaReceiptService } from '../mfa-receipt.service';

@Component({
  selector:'app-account-mfa',standalone:true,imports:[ReactiveFormsModule,MatButtonModule,MatInputModule,MatFormFieldModule],
  styles:[`:host{display:block}section{padding:1.25rem;border:1px solid var(--wrap-border);border-radius:.75rem;background:var(--wrap-card-bg);color:var(--wrap-text-title)}form{display:flex;flex-direction:column;gap:.75rem}p{color:var(--wrap-text-muted);margin:.75rem 0}code{display:block;overflow-wrap:anywhere;user-select:all;padding:.5rem;border:1px solid var(--wrap-border);border-radius:.5rem}li{margin:.25rem 0}h2{font-size:1.125rem;font-weight:600}button{align-self:start} .error{color:var(--wrap-text-title);border-inline-start:3px solid #dc2626;padding-inline-start:.75rem}`],
  template:`<section aria-labelledby="mfa-title"><h2 id="mfa-title">Verificación en dos pasos</h2>
    @if(error()){<p role="alert" class="error">{{error()}}</p>}
    @if(!loaded()){
      <p>{{busy() ? 'Consultando configuración…' : 'No se pudo consultar la configuración.'}}</p>
      <button mat-button type="button" [disabled]="busy()" (click)="load()">Reintentar</button>
    } @else {
      <p>{{enabled() ? 'Activada. Tu contraseña se complementa con un código temporal.' : 'Añade un código temporal de tu aplicación autenticadora al iniciar sesión.'}}</p>
      @if(enabled()){<p>Códigos de respaldo disponibles: {{remaining()}}. Si necesitas reemplazarlos, desactiva y vuelve a configurar la verificación.</p>}
      @if(setup();as enrollment){
        <p>En tu autenticador, agrega una cuenta con clave manual. Nombre: {{enrollment.account}}. Emisor: {{enrollment.issuer}}. Tipo: basado en tiempo (TOTP), 6 dígitos, 30 segundos, SHA-1.</p>
        <code aria-label="Clave de configuración">{{enrollment.secret}}</code>
        <p>Esta configuración vence en 10 minutos. Confirma un código de tu aplicación para activarla. No compartas esta clave.</p>
        <form [formGroup]="codeForm" (ngSubmit)="confirm()">
          <mat-form-field><mat-label>Código del autenticador</mat-label><input matInput formControlName="code" autocomplete="one-time-code" inputmode="numeric" maxlength="6"></mat-form-field>
          <button mat-flat-button [disabled]="busy()||codeForm.invalid">Confirmar activación</button>
          <button mat-button type="button" [disabled]="busy()" (click)="cancel()">Cancelar configuración</button>
        </form>
      } @else if(available()) {
        <form [formGroup]="passwordForm" (ngSubmit)="enabled() ? disable() : begin()">
          <mat-form-field><mat-label>Contraseña actual para verificación</mat-label><input matInput type="password" formControlName="currentPassword" autocomplete="current-password"></mat-form-field>
          @if(enabled()){
            <mat-form-field><mat-label>Código del autenticador o respaldo</mat-label><input matInput formControlName="code" autocomplete="one-time-code" maxlength="35"></mat-form-field>
            <p>Desactivar cerrará todas tus sesiones y eliminará los códigos de respaldo.</p>
          }
          <button mat-flat-button [disabled]="busy()||passwordForm.controls.currentPassword.invalid||(enabled()&&!passwordForm.controls.code.value)">{{busy() ? 'Procesando…' : enabled() ? 'Desactivar verificación' : 'Configurar verificación en dos pasos'}}</button>
        </form>
      } @else {<p>El servidor necesita configurar su clave de cifrado para habilitar esta función.</p>}
    }
  </section>`,
})
export class MfaComponent implements OnInit {
  private readonly auth=inject(AuthService);private readonly router=inject(Router);private readonly fb=inject(FormBuilder);
  private readonly receipt=inject(MfaReceiptService);
  readonly busy=signal(false);readonly loaded=signal(false);readonly enabled=signal(false);readonly available=signal(false);readonly remaining=signal(0);
  readonly error=signal('');readonly setup=signal<{secret:string;issuer:string;account:string}|null>(null);
  readonly passwordForm=this.fb.nonNullable.group({currentPassword:['',Validators.required],code:['']});
  readonly codeForm=this.fb.nonNullable.group({code:['',[Validators.required,Validators.pattern(/^\d{6}$/)]]});
  ngOnInit(){this.load();}
  load(){if(this.busy())return;this.busy.set(true);this.error.set('');this.auth.getMfaStatus().pipe(finalize(()=>this.busy.set(false))).subscribe({
    next:value=>{this.loaded.set(true);this.enabled.set(value.enabled);this.available.set(value.available);this.remaining.set(value.recoveryCodesRemaining);},error:()=>this.error.set('No se pudo cargar la verificación en dos pasos.'),
  });}
  begin(){if(this.busy()||this.passwordForm.controls.currentPassword.invalid)return;this.start();this.auth.setupMfa(this.passwordForm.getRawValue().currentPassword).pipe(finalize(()=>this.busy.set(false))).subscribe({
    next:value=>{this.setup.set(value);this.passwordForm.reset();},error:error=>this.fail(error),
  });}
  confirm(){if(this.busy()||this.codeForm.invalid)return;this.start();this.auth.confirmMfa(this.codeForm.getRawValue().code).pipe(finalize(()=>this.busy.set(false))).subscribe({
    next:value=>{this.setup.set(null);this.codeForm.reset();this.receipt.publish(value.recoveryCodes);this.auth.clearSession();void this.router.navigate(['/login/respaldos']);},error:error=>this.fail(error),
  });}
  disable(){if(this.busy()||!this.passwordForm.getRawValue().code||this.passwordForm.controls.currentPassword.invalid)return;this.start();const {currentPassword,code}=this.passwordForm.getRawValue();
    this.auth.disableMfa(currentPassword,code).pipe(finalize(()=>this.busy.set(false))).subscribe({next:()=>this.finish(),error:error=>this.fail(error)});}
  cancel(){this.setup.set(null);this.codeForm.reset();this.passwordForm.reset();this.error.set('');}
  finish(){this.cancel();this.auth.clearSession();void this.router.navigate(['/login']);}
  private start(){this.busy.set(true);this.error.set('');}
  private fail(error:unknown){this.passwordForm.reset();this.codeForm.reset();this.error.set(error instanceof HttpErrorResponse&&typeof error.error?.message==='string'?error.error.message:'No se pudo completar la operación.');}
}
