import { Component, HostListener, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MfaReceiptService } from '../mfa-receipt.service';

@Component({
  selector:'app-mfa-receipt',standalone:true,imports:[MatButtonModule],
  styles:[`:host{display:block;min-height:100vh;background:var(--wrap-bg);color:var(--wrap-text-title);padding:1.5rem}main{max-width:40rem;margin:2rem auto;padding:1.5rem;border-radius:1rem;background:var(--wrap-card-bg);border:1px solid var(--wrap-border)}h1{font-size:1.5rem;font-weight:700;color:var(--wrap-text-title)}p{margin:1rem 0;color:var(--wrap-text-muted)}ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:.5rem;margin:1rem 0}code{display:block;overflow-wrap:anywhere;user-select:all;padding:.5rem;border:1px solid var(--wrap-border);border-radius:.5rem}button{white-space:normal;height:auto!important;min-height:3rem}`],
  template:`<main>
    <h1>Guarda tus códigos de respaldo</h1>
    @if(codes().length){
      <p>Activaste la verificación en dos pasos. Guarda estos diez códigos en un lugar seguro: cada uno sirve una sola vez si pierdes acceso a tu autenticador. No volverán a mostrarse.</p>
      <ul aria-label="Códigos de respaldo">@for(code of codes();track code){<li><code>{{code}}</code></li>}</ul>
      <p>Se cerraron tus sesiones. Necesitarás tu contraseña y el autenticador o un código de respaldo para volver a entrar. Recargar o salir descarta esta pantalla.</p>
      <button mat-flat-button type="button" (click)="finish()">Ya guardé mis códigos · Iniciar sesión</button>
    } @else {<p>No hay códigos pendientes de guardar. Regresa al inicio de sesión.</p>}
  </main>`,
})
export class MfaReceiptComponent implements OnInit {
  private readonly router=inject(Router);
  readonly codes=signal(inject(MfaReceiptService).take());
  ngOnInit():void{if(!this.codes().length)void this.router.navigate(['/login']);}
  canDeactivate():boolean{return !this.codes().length||window.confirm('¿Ya guardaste tus códigos? Al salir no volverán a mostrarse.');}
  @HostListener('window:beforeunload',['$event']) protect(event:BeforeUnloadEvent):void{if(this.codes().length)event.preventDefault();}
  finish():void{this.codes.set([]);void this.router.navigate(['/login']);}
}
