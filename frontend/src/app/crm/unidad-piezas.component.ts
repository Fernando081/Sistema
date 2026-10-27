import { CommonModule } from '@angular/common';
import { Component, DestroyRef, Input, OnChanges, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, finalize } from 'rxjs';
import { ConfirmService } from '../shared/confirm.service';
import { TextPromptService } from '../shared/text-prompt.service';
import { CompatibilidadPieza, GarantiaCandidata, PiezaGarantia, PiezaOrigen, PiezaUnidad, PiezasPagina, UnidadPiezasService } from '../services/unidad-piezas.service';

const localTime = () => { const value = new Date(); return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 19); };
@Component({selector: 'app-unidad-piezas', standalone: true,
 imports: [CommonModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
 templateUrl: './unidad-piezas.component.html', styleUrl: './unidad-expediente.component.css'})
export class UnidadPiezasComponent implements OnChanges {
 @Input({required: true}) unidad!: number;
 @Input() cliente: number | null = null;
 @Input() gestionar = false;
 @Input() administrar = false;
 private readonly api = inject(UnidadPiezasService);
 private readonly fb = inject(FormBuilder);
 private readonly destroy = inject(DestroyRef);
 private readonly confirm = inject(ConfirmService);
 private readonly prompt = inject(TextPromptService);
 readonly history = signal<PiezasPagina<PiezaUnidad> | null>(null);
 readonly sources = signal<PiezasPagina<PiezaOrigen> | null>(null);
 readonly candidates = signal<PiezasPagina<GarantiaCandidata> | null>(null);
 readonly auditing = signal<PiezaUnidad | null>(null); readonly linksHistory = signal<PiezasPagina<PiezaGarantia> | null>(null);
 readonly loading = signal(false); readonly busy = signal(false); readonly searching = signal(false);
 readonly error = signal(''); readonly message = signal(''); readonly pending = signal(false);
 readonly creating = signal(false); readonly reviewing = signal<PiezaUnidad | null>(null); readonly linking = signal<PiezaUnidad | null>(null);
 readonly term = new FormControl('', {nonNullable: true, validators: [Validators.maxLength(100)]});
 readonly sourceTerm = new FormControl('', {nonNullable: true, validators: [Validators.maxLength(100)]});
 readonly claimTerm = new FormControl('', {nonNullable: true, validators: [Validators.maxLength(100)]});
 readonly form = this.fb.group({idConcepto: this.fb.control<number | null>(null, Validators.required), cantidad: [1, [Validators.required, Validators.min(0.000001)]], fecha: [localTime(), Validators.required], detalle: ['', [Validators.required, Validators.maxLength(1000)]], compatibilidad: this.fb.nonNullable.control<CompatibilidadPieza>('Pendiente'), referencia: ['', [Validators.required, Validators.maxLength(1000)]]});
 readonly revision = this.fb.nonNullable.group({compatibilidad: this.fb.nonNullable.control<CompatibilidadPieza>('Pendiente'), referencia: ['', [Validators.required, Validators.maxLength(1000)]]});
 readonly claim = this.fb.group({idGarantia: this.fb.control<number | null>(null, Validators.required), motivo: ['', [Validators.required, Validators.maxLength(1000)]]});
 private epoch = 0; private loadNumber = 0;
 private readonly intents = new Map<string, {key: string; signature: string}>();
 ngOnChanges() {
  this.epoch++; this.busy.set(false); this.searching.set(false); this.creating.set(false); this.reviewing.set(null); this.linking.set(null); this.auditing.set(null); this.linksHistory.set(null);
  this.intents.clear(); this.pending.set(false); this.sources.set(null); this.candidates.set(null); this.error.set(''); this.message.set('');
  this.term.reset(''); this.sourceTerm.reset(''); this.claimTerm.reset('');
  this.form.reset({idConcepto: null, cantidad: 1, fecha: localTime(), detalle: '', compatibilidad: 'Pendiente', referencia: ''});
  this.load();
 }
 private messageOf(error: unknown) { if (error instanceof HttpErrorResponse) { const value = error.error?.message; if (typeof value === 'string') return value; if (Array.isArray(value)) return value.join('. '); } return 'No se pudo completar la operación. Revisa la conexión y reintenta.'; }
 load(page = 1) {
  if (this.term.invalid || this.busy()) return; const epoch = this.epoch, request = ++this.loadNumber;
  this.loading.set(true); this.error.set('');
  this.api.list(this.unidad, page, this.term.value.trim()).pipe(finalize(() => { if (epoch === this.epoch && request === this.loadNumber) this.loading.set(false); }), takeUntilDestroyed(this.destroy)).subscribe({next: value => { if (epoch === this.epoch && request === this.loadNumber) this.history.set(value); }, error: e => { if (epoch === this.epoch && request === this.loadNumber) { this.history.set(null); this.error.set(this.messageOf(e)); } }});
 }
 startCreate() { this.creating.set(true); this.reviewing.set(null); this.linking.set(null); this.findSources(); }
 findSources(page = 1) {
  if (this.sourceTerm.invalid || this.busy() || this.searching()) return; const epoch = this.epoch;
  this.searching.set(true); this.error.set(''); this.sources.set(null); this.form.controls.idConcepto.reset(null);
  this.api.sources(this.unidad, page, this.sourceTerm.value.trim()).pipe(finalize(() => { if (epoch === this.epoch) this.searching.set(false); }), takeUntilDestroyed(this.destroy)).subscribe({next: value => { if (epoch === this.epoch) this.sources.set(value); }, error: e => { if (epoch === this.epoch) this.error.set(this.messageOf(e)); }});
 }
 selectedSource() { return this.sources()?.data.find(row => row.idConcepto === this.form.controls.idConcepto.value); }
 showLinks(piece: PiezaUnidad, page = 1) { if (this.busy() || this.searching()) return; const epoch = this.epoch;
  this.auditing.set(piece); this.linksHistory.set(null); this.searching.set(true); this.error.set('');
  this.api.history(this.unidad, piece.idPieza, page).pipe(finalize(() => { if (epoch === this.epoch) this.searching.set(false); }), takeUntilDestroyed(this.destroy)).subscribe({next: value => { if (epoch === this.epoch && this.auditing()?.idPieza === piece.idPieza) this.linksHistory.set(value); }, error: e => { if (epoch === this.epoch) this.error.set(this.messageOf(e)); }});
 }
 private key(kind: string, body: unknown) { const signature = JSON.stringify(body), previous = this.intents.get(kind); if (previous && previous.signature !== signature) throw new Error('Hay un envío pendiente con otros datos. Revisa el historial antes de preparar otro registro.'); const intent = previous ?? {key: crypto.randomUUID(), signature}; this.intents.set(kind, intent); this.pending.set(true); return intent.key; }
 private mutate(kind: string, request: Observable<unknown>, success: () => void) {
  const epoch = this.epoch; this.busy.set(true); this.error.set(''); this.message.set('');
  request.pipe(finalize(() => { if (epoch === this.epoch) this.busy.set(false); }), takeUntilDestroyed(this.destroy)).subscribe({next: () => { if (epoch !== this.epoch) return; this.intents.delete(kind); this.pending.set(this.intents.size > 0); success(); this.message.set('Cambio guardado en el historial de piezas.'); this.busy.set(false); this.load(); }, error: e => { if (epoch !== this.epoch) return; if (e instanceof HttpErrorResponse && e.status >= 400 && e.status < 500) { this.intents.delete(kind); this.pending.set(this.intents.size > 0); } this.error.set(this.messageOf(e)); }});
 }
 save() {
  if (this.form.invalid || this.busy() || this.searching() || this.loading()) return;
  try { const raw = this.form.getRawValue(), body = {...raw, fecha: new Date(raw.fecha!).toISOString(), detalle: raw.detalle?.trim(), referencia: raw.referencia?.trim()}, requestId = this.key('instalacion', body);
   this.mutate('instalacion', this.api.create(this.unidad, {...body, requestId}), () => { this.creating.set(false); this.form.reset({idConcepto: null, cantidad: 1, fecha: localTime(), detalle: '', compatibilidad: 'Pendiente', referencia: ''}); });
  } catch (e) { this.error.set(e instanceof Error ? e.message : 'Revisa los datos.'); }
 }
 startReview(piece: PiezaUnidad) { this.reviewing.set(piece); this.creating.set(false); this.linking.set(null); this.revision.reset({compatibilidad: piece.compatibilidad, referencia: piece.referencia}); }
 saveReview() { const piece = this.reviewing(); if (!piece || this.revision.invalid || this.busy() || this.loading()) return; const body = this.revision.getRawValue(); this.mutate('revision', this.api.review(this.unidad, piece.idPieza, {...body, referencia: body.referencia.trim(), version: piece.version}), () => this.reviewing.set(null)); }
 startLink(piece: PiezaUnidad) { this.linking.set(piece); this.reviewing.set(null); this.creating.set(false); this.claim.reset({idGarantia: null, motivo: ''}); this.claimTerm.reset(''); this.findClaims(); }
 findClaims(page = 1) {
  const piece = this.linking(); if (!piece || this.claimTerm.invalid || this.busy() || this.searching()) return; const epoch = this.epoch;
  this.searching.set(true); this.error.set(''); this.candidates.set(null); this.claim.controls.idGarantia.reset(null);
  this.api.claims(this.unidad, piece.idPieza, page, this.claimTerm.value.trim()).pipe(finalize(() => { if (epoch === this.epoch) this.searching.set(false); }), takeUntilDestroyed(this.destroy)).subscribe({next: value => { if (epoch === this.epoch && this.linking()?.idPieza === piece.idPieza) this.candidates.set(value); }, error: e => { if (epoch === this.epoch) this.error.set(this.messageOf(e)); }});
 }
 saveLink() { const piece = this.linking(); if (!piece || this.claim.invalid || this.busy() || this.searching() || this.loading()) return;
  try { const raw = this.claim.getRawValue(), body = {...raw, motivo: raw.motivo?.trim()}, kind = 'vinculo-' + piece.idPieza, requestId = this.key(kind, body); this.mutate(kind, this.api.link(this.unidad, piece.idPieza, {...body, requestId}), () => this.linking.set(null)); } catch (e) { this.error.set(e instanceof Error ? e.message : 'Revisa el vínculo.'); }
 }
 correct(piece: PiezaUnidad, link?: number) { if (this.busy() || this.loading()) return; const epoch = this.epoch;
  this.prompt.ask({title: link ? 'Retirar vínculo de garantía' : 'Anular instalación', message: 'Se conserva el historial. Esta corrección no modifica inventario ni resuelve la garantía.', label: 'Motivo de la corrección', confirmLabel: 'Confirmar'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(motivo => { if (!motivo || epoch !== this.epoch) return; this.mutate('correccion', link ? this.api.unlink(this.unidad, piece.idPieza, link, motivo) : this.api.annul(this.unidad, piece.idPieza, motivo), () => {}); });
 }
 resetIntent() { const epoch = this.epoch; this.confirm.ask({title: 'Preparar otro registro', message: 'Confirma que revisaste el historial para comprobar si el envío pendiente quedó registrado.', confirmLabel: 'Ya revisé el historial'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(value => { if (value && epoch === this.epoch) { this.intents.clear(); this.pending.set(false); this.error.set(''); } }); }
}
