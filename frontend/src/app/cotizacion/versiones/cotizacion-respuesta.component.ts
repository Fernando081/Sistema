import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnDestroy, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Meta } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { CotizacionVersionService, PublicQuote, QuoteReceipt } from '../../services/cotizacion-version.service';
import { FinancialRequestIntent } from '../../shared/financial-request-intent';
@Component({standalone:true,selector:'app-cotizacion-respuesta',imports:[CommonModule,ReactiveFormsModule,MatButtonModule,MatFormFieldModule,MatInputModule],styleUrl:'./cotizacion-version.component.css',template:`
<main class="quote-version" aria-labelledby="response-title"><h1 id="response-title">Refacciones y Tractorepuestos Tampico</h1><p>Respuesta comercial de cotización</p>
@if(error()){<p role="alert">{{error()}}</p>}@if(busy()){<p role="status">Consultando o guardando respuesta…</p>}
@if(data();as d){<section><h2>Cotización C-{{d.snapshot.folio}} · Revisión {{d.numero}}</h2><p>Propuesta para {{d.snapshot.nombre}} · Vence {{d.snapshot.vencimiento|date:'medium'}}</p>
<div class="table-scroll" tabindex="0" role="region" aria-label="Renglones de la cotización"><table><caption>Contenido de esta revisión, importes MXN</caption><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Importe</th></tr></thead><tbody>@for(c of d.snapshot.conceptos;track c.idConcepto){<tr><td>{{c.descripcion}}</td><td>{{c.cantidad}} {{c.unidad}}</td><td>{{c.precio|currency:'MXN'}}</td><td>{{c.importe|currency:'MXN'}}</td></tr>}</tbody></table></div><p>Subtotal {{d.snapshot.subtotal|currency:'MXN'}} · Impuestos {{d.snapshot.impuestos|currency:'MXN'}} · Retenciones {{d.snapshot.retenciones|currency:'MXN'}}</p><h3>Total {{d.snapshot.total|currency:'MXN'}}</h3><p>Responder no realiza cargos ni crea un pedido automáticamente. El nombre se registra como declarado; este enlace no verifica identidad.</p></section>
@if(receipt();as r){<section role="status"><h2>Respuesta registrada: {{r.decision}}</h2><p>{{r.nombre}} · {{r.fecha|date:'medium'}}</p><p>{{r.comentario}}</p><p>Para cambiar la respuesta, solicita una nueva revisión al negocio.</p></section>}
@else{<section><h2>Responder a esta revisión</h2><form [formGroup]="form" (ngSubmit)="send()"><label for="quote-decision">Decisión</label><select id="quote-decision" formControlName="decision"><option value="" disabled>Selecciona una decisión</option><option value="Aceptada">Aceptar propuesta</option><option value="Rechazada">Rechazar propuesta</option></select><mat-form-field><mat-label>Tu nombre</mat-label><input matInput formControlName="nombre" maxlength="150"></mat-form-field><mat-form-field><mat-label>Comentario de respuesta</mat-label><textarea matInput formControlName="comentario" maxlength="1000"></textarea></mat-form-field><label><input type="checkbox" formControlName="confirmacion"> Confirmo que revisé la revisión {{d.numero}} y estoy autorizado para comunicar esta decisión.</label><button mat-flat-button [disabled]="form.invalid||busy()">Registrar respuesta</button></form></section>}}
<button mat-stroked-button (click)="load()" [disabled]="busy()">Actualizar respuesta</button></main>`})
export class CotizacionRespuestaComponent implements OnDestroy{
 private readonly api=inject(CotizacionVersionService);private readonly fb=inject(FormBuilder);private readonly meta=inject(Meta);private readonly destroy=inject(DestroyRef);private readonly intent=new FinancialRequestIntent();private token='';
 readonly busy=signal(false);readonly error=signal('');readonly data=signal<PublicQuote|null>(null);readonly receipt=signal<QuoteReceipt|null>(null);
 readonly form=this.fb.nonNullable.group({decision:['',Validators.required],nombre:['',[Validators.required,Validators.minLength(2),Validators.maxLength(150)]],comentario:['',[Validators.required,Validators.maxLength(1000)]],confirmacion:[false,Validators.requiredTrue]});
 constructor(){this.meta.updateTag({name:'robots',content:'noindex, nofollow, noarchive'});this.token=new URLSearchParams(location.hash.slice(1)).get('token')??'';history.replaceState(history.state,'',location.pathname+location.search);this.load();}
 ngOnDestroy(){this.token='';this.meta.removeTag('name="robots"');}
 private message(e:unknown){if(e instanceof HttpErrorResponse){const m=e.error?.message;if(typeof m==='string')return m;if(Array.isArray(m))return m.join('. ');}return 'No se pudo confirmar la operación. Actualiza la respuesta o reintenta con los mismos datos.';}
 load(){if(this.busy())return;if(!/^[A-Za-z0-9_-]{43}$/.test(this.token)){this.error.set('Abre el enlace completo que te compartió el negocio.');return;}this.busy.set(true);this.error.set('');this.api.consult(this.token).pipe(finalize(()=>this.busy.set(false)),takeUntilDestroyed(this.destroy)).subscribe({next:d=>{this.data.set(d);this.receipt.set(d.respuesta);},error:e=>{this.data.set(null);this.error.set(this.message(e));}});}
 send(){if(this.form.invalid||this.busy())return;try{const raw=this.form.getRawValue(),body={...raw,nombre:raw.nombre.trim(),comentario:raw.comentario.trim()},requestId=this.intent.begin('respuesta',body);this.busy.set(true);this.error.set('');this.api.respond({...body,requestId,token:this.token}).pipe(finalize(()=>this.busy.set(false)),takeUntilDestroyed(this.destroy)).subscribe({next:r=>{this.intent.success('respuesta');this.receipt.set(r.respuesta);},error:e=>{this.intent.failure('respuesta',e.status);this.error.set(this.message(e));}});}catch(e){this.error.set(e instanceof Error?e.message:'Revisa los datos.');}}
}
