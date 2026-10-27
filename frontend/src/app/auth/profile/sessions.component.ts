import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService, AuthSession } from '../auth.service';
import { ConfirmService } from '../../shared/confirm.service';

@Component({
  selector:'app-account-sessions',standalone:true,imports:[DatePipe,MatButtonModule],
  template:`<section class="session-panel" aria-labelledby="sessions-title">
    <header><div><h2 id="sessions-title">Sesiones activas</h2><p>Revisa los accesos de tu cuenta y cierra los que ya no utilices.</p></div>
      <button mat-button type="button" [disabled]="loading() || busy()" (click)="load()">Actualizar sesiones</button></header>
    <p class="hint">Cada inicio de sesión aparece por separado. El navegador y sistema son orientativos; no identifican un equipo físico. Las pestañas que comparten acceso cuentan como una sesión.</p>
    @if(loading()){<p role="status">Cargando sesiones…</p>}
    @if(error()){<p role="alert">No se pudieron consultar tus sesiones. Usa Actualizar sesiones para reintentar.</p>}
    @for(session of sessions();track session.idSession){<article [attr.aria-label]="session.current ? 'Sesión actual' : 'Sesión en '+session.clientLabel">
      <div class="session-heading"><h3>{{session.clientLabel}}</h3>@if(session.current){<span class="current">Esta sesión</span>}</div>
      <dl><div><dt>Inicio</dt><dd>{{session.createdAt|date:'medium'}}</dd></div>
        <div><dt>Última actividad aproximada</dt><dd>{{session.lastSeenAt|date:'medium'}}</dd></div>
        <div><dt>Vence</dt><dd>{{session.expiresAt|date:'medium'}}</dd></div></dl>
      <button mat-button type="button" [disabled]="busy() || loading()" (click)="close(session)">{{session.current ? 'Cerrar esta sesión' : 'Cerrar sesión en '+session.clientLabel}}</button>
    </article>}@empty{ @if(!loading() && !error()){<p>No hay sesiones activas disponibles.</p>} }
    <footer><p>Al cerrar todas las sesiones tendrás que iniciar sesión de nuevo en tus navegadores.</p>
      <button mat-flat-button type="button" [disabled]="busy() || loading()" (click)="closeAll()">Cerrar todas mis sesiones</button></footer>
  </section>`,
  styles:[`:host{display:block}.session-panel{background:var(--wrap-card-bg);color:var(--wrap-text-title);border:1px solid var(--wrap-border);border-radius:12px;padding:1.25rem}
    header,.session-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;flex-wrap:wrap}h2,h3{margin:0}h2{font-size:1.2rem}h3{font-size:1rem}p,dt{color:var(--wrap-text-muted)}p{margin:.5rem 0 1rem}.hint{font-size:.875rem}
    article{border:1px solid var(--wrap-border);padding:1rem;margin:1rem 0;border-radius:10px;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:.75rem;margin:1rem 0}dt{font-size:.8rem}dd{margin:.25rem 0 0;font-size:.9rem}.current{font-size:.8rem;border:1px solid var(--wrap-border);border-radius:99px;padding:.2rem .6rem;font-weight:600}footer{border-top:1px solid var(--wrap-border);padding-top:1rem}`],
})
export class SessionsComponent implements OnInit {
  private readonly auth=inject(AuthService);
  private readonly confirm=inject(ConfirmService);
  private readonly router=inject(Router);
  private readonly snack=inject(MatSnackBar);
  readonly sessions=signal<AuthSession[]>([]);
  readonly loading=signal(false);
  readonly busy=signal(false);
  readonly error=signal(false);

  ngOnInit() {this.load();}
  load() {
    if(this.loading())return;
    this.loading.set(true);this.error.set(false);
    this.auth.getSessions().pipe(finalize(()=>this.loading.set(false))).subscribe({next:rows=>this.sessions.set(rows),error:()=>{this.sessions.set([]);this.error.set(true);}});
  }
  close(session: AuthSession) {
    if(this.busy())return;
    this.confirm.ask({title:'Cerrar sesión',message:session.current?'Se cerrará este acceso y volverás al inicio de sesión.':`Se cerrará el acceso en ${session.clientLabel}. Tus otras sesiones seguirán activas.`,confirmLabel:'Cerrar sesión',tone:'danger'})
      .subscribe(confirmed=>{if(!confirmed||this.busy())return;this.busy.set(true);
        this.auth.revokeSession(session.idSession).pipe(finalize(()=>this.busy.set(false))).subscribe({next:result=>{
          if(result.current)this.leave();else{this.load();this.snack.open('Sesión cerrada.','Cerrar');}
        },error:()=>{}});
      });
  }
  closeAll() {
    if(this.busy())return;
    this.confirm.ask({title:'Cerrar todas las sesiones',message:'Se cerrarán todos los accesos de tu cuenta, incluido este. Tendrás que iniciar sesión de nuevo.',confirmLabel:'Cerrar todas',tone:'danger'})
      .subscribe(confirmed=>{if(!confirmed||this.busy())return;this.busy.set(true);
        this.auth.logoutAll().pipe(finalize(()=>this.busy.set(false))).subscribe({next:()=>this.leave(),error:()=>{}});
      });
  }
  private leave() {this.auth.clearSession();void this.router.navigate(['/login']);this.snack.open('Sesiones cerradas. Inicia sesión nuevamente.','Cerrar');}
}
