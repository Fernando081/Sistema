import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService, AuthUser } from '../auth/auth.service';
import { environment } from '../../environments/environment';
import { timeout } from 'rxjs';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
import { CrmWebMetricsComponent } from './crm-web-metrics.component';

interface ReceiptStatus {
  requestId: string; estado: string; version: number; createdAt: string; expiresAt: string;
  idOportunidad: number | null; contenido: 'Vigente' | 'Vencido' | 'Purgado';
}
interface BridgeStatus {
  enabled: boolean; configured: boolean; mode: string; activeKeyId: string | null;
  previous: { keyId: string; from: string; until: string; accepting: boolean } | null;
}
type ResolutionReason = 'Contenido' | 'Catalogo' | 'Clave' | 'Confirmacion';
interface WebResolution {
  operationId: string; requestId: string; motivo: ResolutionReason; decision: 'ConservarOriginal';
  expectedVersion: number; version: number; contenido: string; idOportunidad: number | null; idAutor: number; createdAt: string;
}

interface WebRequest {
  requestId: string; estado: string; version: number; createdAt: string; idOportunidad?: number | null;
  payload: { contact: { name: string; channel: string; value: string };
    items: { code: string; brand?: string; quantity: number; application?: string }[] };
}
@Component({
  selector: 'app-crm-solicitudes-web', standalone: true,
  imports: [CommonModule, MatButtonModule, RouterLink, FormsModule, CrmWebMetricsComponent],
  template: `
    <section aria-labelledby="web-inbox-title" [attr.aria-busy]="loading()">
      <h2 id="web-inbox-title">Solicitudes de la web</h2>
      <p>La recepción pública todavía no está activada. Aquí aparecerán las solicitudes vigentes recibidas por el puente autorizado.</p>
      <app-crm-web-metrics />
      <details class="bridge-check">
        <summary>Estado del puente de recepción</summary>
        <p>Consulta administrativa sin claves privadas. La configuración del backend no confirma que el formulario público esté activado.</p>
        <button mat-stroked-button (click)="loadBridge()" [disabled]="bridgeLoading()">Consultar configuración del puente</button>
        @if (bridgeLoading()) { <p role="status">Comprobando configuración…</p> }
        @if (bridgeError()) { <p role="alert">{{bridgeError()}}</p> }
        @if (bridge(); as config) {
          <div role="status">
            <p>Receptor backend: {{config.enabled && config.configured ? 'Habilitado' : 'Cerrado'}}.</p>
            <p>Configuración: {{config.configured ? 'Válida' : 'Pendiente o inválida'}} · Protocolo: {{config.mode}}.</p>
            @if (config.activeKeyId) { <p>ID de firma activa: {{config.activeKeyId}}</p> }
            @if (config.previous; as previous) {
              <p>Firma anterior: {{previous.keyId}} · {{previous.accepting ? 'En transición' : 'Fuera del intervalo'}}.</p>
              <p>Intervalo: {{previous.from | date:'short'}} — {{previous.until | date:'short'}}.</p>
            } @else { <p>Sin firma anterior configurada.</p> }
            <p>Estado del momento de consulta; vuelve a consultar al terminar una transición. Las claves se administran en el servidor.</p>
          </div>
        }
      </details>
      <section class="receipt-check" aria-labelledby="web-receipt-title" [attr.aria-busy]="receiptLoading()">
        <h3 id="web-receipt-title">Comprobar recepción</h3>
        <p>Usa el identificador de una solicitud cuyo recibo no se confirmó para consultar su estado antes de volver a enviarla.</p>
        <form (ngSubmit)="checkReceipt()">
          <label for="web-receipt-id">Identificador de solicitud</label>
          <input id="web-receipt-id" name="requestId" type="text" maxlength="36" autocomplete="off" spellcheck="false"
            [ngModel]="receiptId()" (ngModelChange)="changeReceiptId($event)" [disabled]="receiptLoading() || resolutionSaving() || !!resolutionIntent()"
            aria-describedby="web-receipt-help">
          <p id="web-receipt-help">Formato UUID: 36 caracteres, incluidos los guiones.</p>
          <div class="actions">
            <button mat-stroked-button type="submit" [disabled]="receiptLoading() || resolutionSaving()">Consultar estado</button>
            <button mat-button type="button" (click)="clearReceipt()" [disabled]="receiptLoading() || resolutionSaving() || !!resolutionIntent()">Limpiar consulta</button>
          </div>
        </form>
        @if (receiptLoading()) { <p role="status">Comprobando recepción…</p> }
        @if (receiptError()) { <p role="alert">{{receiptError()}}</p> }
        @if (receipt(); as result) {
          <div role="status">
            <p><strong>Registro encontrado.</strong> Estado comercial: {{result.estado}}.</p>
            <p class="request-id">Identificador: {{result.requestId}}</p>
            <p>Registrada: {{result.createdAt | date:'short'}} · Vencimiento de bandeja: {{result.expiresAt | date:'short'}}</p>
            <p>Contenido de la bandeja: {{result.contenido}}.</p>
            @if (result.contenido === 'Vigente') { <p>Revisa la solicitud en la bandeja antes de realizar otro envío.</p> }
            @else { <p>El contacto y las piezas ya no se muestran en la bandeja. Esta consulta no restaura sus datos.</p> }
            @if (result.idOportunidad) { <p>Oportunidad vinculada en CRM: #{{result.idOportunidad}}. Conserva el vínculo existente.</p> }
            <p>Encontrar el registro no confirma que las piezas coincidan con un envío modificado ni que se haya realizado una venta.</p>
          </div>
          <section class="resolution-panel" aria-labelledby="web-resolution-title" [attr.aria-busy]="resolutionSaving()">
            <h4 id="web-resolution-title">Resolver revisión conservando el original</h4>
            <p>Si hubo un cambio de contenido, catálogo o clave, comprueba el registro original y su vínculo en CRM antes de decidir. Esta decisión no confirma igualdad con el reenvío ni cambia la huella, las piezas, el contacto o el vencimiento.</p>
            <form (ngSubmit)="resolveOriginal()">
              <label for="web-resolution-reason">Motivo de la revisión</label>
              <select id="web-resolution-reason" name="reason" [ngModel]="resolutionReason()"
                (ngModelChange)="resolutionReason.set($event); resolutionConfirmed.set(false)" [disabled]="!!resolutionIntent()">
                <option value="Confirmacion">Confirmación perdida</option><option value="Contenido">Cambio de contenido</option>
                <option value="Catalogo">Cambio de catálogo</option><option value="Clave">Cambio de clave</option>
              </select>
              <label class="decision-confirm"><input name="originalVerified" type="checkbox" [ngModel]="resolutionConfirmed()"
                (ngModelChange)="resolutionConfirmed.set($event)" [disabled]="!!resolutionIntent()">
                Comprobé el estado y el vínculo; conservaré el registro original sin crear otra solicitud u oportunidad.</label>
              <button mat-stroked-button type="submit" [disabled]="resolutionSaving() || receiptLoading() || !resolutionConfirmed()">
                {{resolutionIntent() ? 'Reintentar la misma decisión' : 'Guardar decisión: conservar original'}}
              </button>
            </form>
            @if (resolutionIntent()) { <p>Conserva esta pantalla. Si falta confirmación, reintenta la misma decisión o consulta su estado e historial; no generes otra decisión.</p> }
            @if (resolutionNotice()) { <p aria-live="polite">{{resolutionNotice()}}</p> }
            @if (resolutionError()) { <p role="alert">{{resolutionError()}}</p> }
            <p>Las correcciones comerciales se revisan en la oportunidad existente. El snapshot original se conserva; un reenvío cambiado seguirá sin sobrescribir la solicitud.</p>
            <h4>Últimas decisiones (hasta 20)</h4>
            @if (resolutionsLoading()) { <p>Cargando historial…</p> }
            @else if (resolutionsError()) { <p role="alert">{{resolutionsError()}}</p><button mat-button (click)="loadResolutions(result.requestId)">Reintentar historial</button> }
            @else if (!resolutions().length) { <p>No hay decisiones registradas.</p> }
            <ul>@for (decision of resolutions(); track decision.operationId) {
              <li>Conservar original · {{decision.motivo}} · {{decision.createdAt | date:'short'}} · Usuario #{{decision.idAutor}} · Versión {{decision.version}} · Contenido al decidir: {{decision.contenido}}</li>
            }</ul>
          </section>
        }
      </section>
      <button mat-stroked-button (click)="load()" [disabled]="loading() || saving()">Actualizar bandeja</button>
      <div class="owner-picker">
        <label for="web-lead-owner">Responsable de las nuevas oportunidades</label>
        <select id="web-lead-owner" [ngModel]="owner()" (ngModelChange)="owner.set($event)" [disabled]="saving()">
          <option [ngValue]="0">A mi cargo</option>
          @for (user of users(); track user.idUser) { <option [ngValue]="user.idUser">{{user.username}}</option> }
        </select>
        @if (ownerError()) { <p role="status">No se pudo cargar el equipo. Puedes crear la oportunidad a tu cargo.</p>
          <button mat-stroked-button (click)="loadUsers()">Reintentar equipo</button> }
      </div>
      @if (error()) { <p role="alert">{{error()}}</p> }
      @if (notice()) { <p role="status">{{notice()}}</p> }
      @if (loading()) { <p role="status">Cargando solicitudes…</p> }
      @if (!loading() && !error() && !rows().length) { <p>No hay solicitudes vigentes en esta página.</p> }
      @for (row of rows(); track row.requestId) {
        <article>
          <h3>{{row.payload.contact.name}}</h3>
          <p>{{row.estado}} · {{row.createdAt | date:'short'}} · {{row.payload.contact.channel}}</p>
          <p class="contact-value">{{row.payload.contact.value}}</p>
          <details><summary>Identificador de esta solicitud</summary><p class="request-id">{{row.requestId}}</p></details>
          <ul>@for (item of row.payload.items; track $index) {
            <li><strong>{{item.code}}</strong> · {{item.brand || 'Marca por confirmar'}} · Cantidad: {{item.quantity}}
              @if (item.application) { <span> · {{item.application}}</span> }
            </li>
          }</ul>
          @if (row.idOportunidad) { <p>Oportunidad CRM #{{row.idOportunidad}}</p>
            <a [routerLink]="['/crm']" [queryParams]="{q: row.payload.contact.name}">Buscar oportunidad en CRM</a>
          } @else if (row.estado !== 'Descartada') {
            <div class="actions">
              <button mat-flat-button (click)="convert(row)" [disabled]="saving() || loading()" [attr.aria-label]="'Crear oportunidad: ' + row.payload.contact.name">{{owner() ? 'Crear oportunidad asignada' : 'Crear oportunidad a mi cargo'}}</button>
              @if (row.estado === 'Pendiente') {
              <button mat-flat-button (click)="review(row, 'Revisada')" [disabled]="saving() || loading()" [attr.aria-label]="'Marcar revisada: ' + row.payload.contact.name">Marcar revisada</button>
              <button mat-stroked-button (click)="review(row, 'Descartada')" [disabled]="saving() || loading()" [attr.aria-label]="'Descartar: ' + row.payload.contact.name">Descartar</button>
              }
            </div>
          }
        </article>
      }
      <nav aria-label="Páginas de solicitudes" class="actions">
        <button mat-stroked-button (click)="move(-1)" [disabled]="page() === 1 || loading() || saving()">Anterior</button>
        <span>Página {{page()}}</span>
        <button mat-stroked-button (click)="move(1)" [disabled]="rows().length < 25 || loading() || saving() || !!error()">Siguiente</button>
      </nav>
    </section>`,
  styles: [`section{padding:20px;color:var(--c-text)}h2,h3,h4,p,li,span,strong{color:var(--c-text)}article{padding:18px 0;border-bottom:1px solid currentColor}.actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:16px}.contact-value,.request-id,li{overflow-wrap:anywhere}h3{margin-bottom:8px}.owner-picker{display:grid;gap:8px;margin:16px 0;max-width:420px}select,input{min-height:44px;width:100%;max-width:100%;box-sizing:border-box;background:var(--c-surface);color:var(--c-text);border:1px solid currentColor;border-radius:8px;padding:8px}.receipt-check{margin:20px 0;padding:16px;border:1px solid currentColor;border-radius:12px}.receipt-check form{max-width:520px}.receipt-check label{display:block;margin-bottom:8px}.bridge-check p{overflow-wrap:anywhere}.bridge-check button:not(:disabled),.receipt-check button:not(:disabled){color:var(--c-text)}summary{cursor:pointer;padding:8px 0}.resolution-panel{padding:16px 0}.receipt-check .decision-confirm{display:flex;align-items:flex-start;gap:12px;margin:16px 0}.decision-confirm input{width:20px;min-height:20px;flex-shrink:0;margin-top:4px}`],
})
export class CrmSolicitudesWebComponent {
  private readonly http = inject(HttpClient);
  private readonly destroy = inject(DestroyRef);
  private readonly auth = inject(AuthService);
  readonly owner = signal(0);
  readonly users = signal<AuthUser[]>([]);
  readonly ownerError = signal(false);
  private readonly api = `${environment.apiBaseUrl}/crm/solicitudes-web`;
  readonly rows = signal<WebRequest[]>([]);
  readonly page = signal(1);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly notice = signal('');
  readonly bridge = signal<BridgeStatus | null>(null);
  readonly bridgeLoading = signal(false);
  readonly bridgeError = signal('');
  readonly receiptId = signal('');
  readonly receipt = signal<ReceiptStatus | null>(null);
  readonly receiptLoading = signal(false);
  readonly receiptError = signal('');
  readonly resolutions = signal<WebResolution[]>([]);
  readonly resolutionsLoading = signal(false);
  readonly resolutionsError = signal('');
  readonly resolutionReason = signal<ResolutionReason>('Confirmacion');
  readonly resolutionConfirmed = signal(false);
  readonly resolutionSaving = signal(false);
  readonly resolutionError = signal('');
  readonly resolutionNotice = signal('');
  readonly resolutionIntent = signal<{ operationId: string; requestId: string; motivo: ResolutionReason; expectedVersion: number; originalVerificado: true } | null>(null);
  private historySequence = 0;
  constructor() { this.load(); this.loadUsers(); }
  loadBridge() {
    if (this.bridgeLoading()) return;
    this.bridgeLoading.set(true); this.bridgeError.set(''); this.bridge.set(null);
    this.http.get<BridgeStatus>(`${this.api}/puente`, { context: new HttpContext().set(LOCAL_ERROR_FEEDBACK, true) })
      .pipe(timeout(10000), takeUntilDestroyed(this.destroy)).subscribe({
        next: status => { this.bridge.set(status); this.bridgeLoading.set(false); },
        error: () => { this.bridgeLoading.set(false); this.bridgeError.set('No se pudo comprobar la configuración. Vuelve a consultar.'); },
      });
  }
  changeReceiptId(value: string) {
    if (this.resolutionIntent()) return;
    this.receiptId.set(value); this.receipt.set(null); this.receiptError.set('');
    this.historySequence++; this.resolutionsLoading.set(false);
    this.resolutions.set([]); this.resolutionsError.set(''); this.resolutionConfirmed.set(false);
    this.resolutionError.set(''); this.resolutionNotice.set('');
  }
  clearReceipt() {
    if (!this.receiptLoading()) this.changeReceiptId('');
  }
  checkReceipt() {
    if (this.receiptLoading() || this.resolutionSaving()) return;
    this.receipt.set(null); this.receiptError.set('');
    const id = this.receiptId().trim().toLowerCase();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) {
      this.receiptError.set('Introduce el identificador UUID completo de la solicitud.'); return;
    }
    this.receiptId.set(id); this.receiptLoading.set(true);
    this.http.get<ReceiptStatus>(this.api + '/' + id + '/estado', {
      context: new HttpContext().set(LOCAL_ERROR_FEEDBACK, true),
    })
      .pipe(timeout(10000), takeUntilDestroyed(this.destroy)).subscribe({
        next: result => { this.receipt.set(result); this.receiptLoading.set(false); this.loadResolutions(id); },
        error: (error: unknown) => {
          this.receiptLoading.set(false);
          this.receiptError.set(error instanceof HttpErrorResponse && error.status === 404
            ? 'No se encontró el registro en esta comprobación. Puede haber un envío en curso; comprueba de nuevo el mismo identificador antes de generar otra solicitud.'
            : 'No se pudo comprobar la recepción. Reintenta la consulta del mismo identificador.');
        },
      });
  }
  loadResolutions(id: string) {
    const sequence = ++this.historySequence;
    this.resolutionsLoading.set(true); this.resolutionsError.set(''); this.resolutions.set([]);
    this.http.get<WebResolution[]>(this.api + '/' + id + '/resoluciones', {
      context: new HttpContext().set(LOCAL_ERROR_FEEDBACK, true),
    }).pipe(timeout(10000), takeUntilDestroyed(this.destroy)).subscribe({
      next: rows => {
        if (this.receipt()?.requestId !== id || sequence !== this.historySequence) return;
        this.resolutions.set(rows); this.resolutionsLoading.set(false);
        const intent = this.resolutionIntent();
        if (intent && rows.some(row => row.operationId === intent.operationId)) this.resolutionCompleted();
      },
      error: () => {
        if (this.receipt()?.requestId !== id || sequence !== this.historySequence) return;
        this.resolutionsLoading.set(false); this.resolutionsError.set('No se pudo cargar el historial de decisiones.');
      },
    });
  }
  private resolutionCompleted() {
    this.resolutionIntent.set(null); this.resolutionConfirmed.set(false); this.resolutionError.set('');
    this.resolutionNotice.set('Decisión registrada: se conserva el original. No se creó otra solicitud ni oportunidad.');
    this.load();
  }
  resolveOriginal() {
    const receipt = this.receipt();
    if (!receipt || !this.resolutionConfirmed() || this.resolutionSaving() || this.receiptLoading()) return;
    const intent = this.resolutionIntent() ?? { operationId: crypto.randomUUID(), requestId: receipt.requestId,
      motivo: this.resolutionReason(), expectedVersion: receipt.version, originalVerificado: true as const };
    this.resolutionIntent.set(intent); this.resolutionSaving.set(true); this.resolutionError.set(''); this.resolutionNotice.set('');
    const { requestId, ...body } = intent;
    this.http.post<WebResolution>(this.api + '/' + requestId + '/resolver', body, {
      context: new HttpContext().set(LOCAL_ERROR_FEEDBACK, true),
    }).pipe(timeout(10000), takeUntilDestroyed(this.destroy)).subscribe({
      next: () => { this.resolutionSaving.set(false); this.resolutionCompleted(); this.checkReceipt(); },
      error: (error: unknown) => {
        this.resolutionSaving.set(false);
        if (error instanceof HttpErrorResponse && [400, 404, 409].includes(error.status)) {
          this.resolutionIntent.set(null); this.resolutionConfirmed.set(false);
          this.resolutionError.set('La decisión no se guardó con estos datos. Consulta de nuevo el estado y revisa la versión antes de decidir.');
        } else {
          this.resolutionError.set('No se pudo confirmar la decisión. Reintenta con el mismo botón o consulta el estado e historial; pudo haberse registrado.');
        }
      },
    });
  }
  loadUsers() {
    this.ownerError.set(false);
    this.auth.getUsers().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: users => { this.users.set(users.filter(user => user.isActive));
        if (this.owner() && !this.users().some(user => user.idUser === this.owner())) this.owner.set(0); },
      error: () => { this.ownerError.set(true); this.users.set([]); this.owner.set(0); },
    });
  }
  load() {
    this.loading.set(true); this.error.set(''); this.rows.set([]);
    this.http.get<WebRequest[]>(this.api, { params: { page: this.page(), limit: 25 } })
      .pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: rows => { this.rows.set(rows); this.loading.set(false); },
        error: () => { this.loading.set(false); this.error.set('No se pudo cargar la bandeja. Reintenta con Actualizar bandeja.'); },
      });
  }
  move(delta: number) { this.page.update(page => page + delta); this.notice.set(''); this.load(); }
  review(row: WebRequest, estado: string) {
    if (this.saving()) return;
    this.saving.set(true); this.notice.set(''); this.error.set('');
    this.http.patch(this.api + '/' + row.requestId, { estado, expectedVersion: row.version })
      .pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: () => { this.saving.set(false); this.notice.set('Solicitud actualizada. Esto no crea una oportunidad ni envía un mensaje.'); this.load(); },
        error: () => { this.saving.set(false); this.error.set('No se pudo actualizar; pudo cambiar o vencer. Actualiza la bandeja antes de reintentar.'); },
      });
  }
  convert(row: WebRequest) {
    if (this.saving()) return;
    this.saving.set(true); this.error.set(''); this.notice.set('');
    this.http.post<{ idOportunidad: number }>(this.api + '/' + row.requestId + '/convertir', { expectedVersion: row.version,
      ...(this.owner() ? { idResponsable: this.owner() } : {}) })
      .pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: result => { this.saving.set(false); this.notice.set('Oportunidad #' + result.idOportunidad + ' creada o recuperada. No se envió ningún mensaje.'); this.load(); },
        error: () => { this.saving.set(false); this.error.set('No se pudo convertir. Actualiza la bandeja y revisa la vigencia de la solicitud.'); },
      });
  }
}
