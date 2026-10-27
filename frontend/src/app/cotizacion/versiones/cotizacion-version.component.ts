import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { CotizacionVersionService, QuoteVersionState } from '../../services/cotizacion-version.service';
import { FinancialRequestIntent } from '../../shared/financial-request-intent';
import { ConfirmService } from '../../shared/confirm.service';
import { TextPromptService } from '../../shared/text-prompt.service';
@Component({standalone:true,selector:'app-cotizacion-version',imports:[CommonModule,ReactiveFormsModule,RouterLink,MatButtonModule,MatFormFieldModule,MatInputModule],templateUrl:'./cotizacion-version.component.html',styleUrl:'./cotizacion-version.component.css'})
export class CotizacionVersionComponent{
 private readonly api=inject(CotizacionVersionService);private readonly route=inject(ActivatedRoute);private readonly destroy=inject(DestroyRef);private readonly confirm=inject(ConfirmService);private readonly prompt=inject(TextPromptService);
 private intents=new FinancialRequestIntent();private epoch=0;id=0;page=1;
 readonly data=signal<QuoteVersionState|null>(null);readonly busy=signal(false);readonly loading=signal(false);readonly error=signal('');readonly link=signal('');readonly expires=signal('');
 readonly motive=new FormControl('',{nonNullable:true,validators:[Validators.required,Validators.maxLength(1000)]});
 constructor(){this.route.paramMap.pipe(takeUntilDestroyed(this.destroy)).subscribe(p=>{this.id=Number(p.get('id'));this.epoch++;this.intents=new FinancialRequestIntent();this.link.set('');this.busy.set(false);this.load();});}
 private message(e:unknown){if(e instanceof HttpErrorResponse){const m=e.error?.message;if(Array.isArray(m))return m.join('. ');if(typeof m==='string')return m;}return 'No se pudo completar. Revisa la conexión y reintenta.';}
 load(page=1){const epoch=this.epoch;if(this.busy())return;this.page=page;this.loading.set(true);this.error.set('');this.api.state(this.id,page).pipe(finalize(()=>{if(epoch===this.epoch)this.loading.set(false);}),takeUntilDestroyed(this.destroy)).subscribe({next:d=>{if(epoch===this.epoch)this.data.set(d);},error:e=>{if(epoch===this.epoch){this.data.set(null);this.error.set(this.message(e));}}});}
 seal(){if(this.motive.invalid||this.busy()||this.loading())return;const epoch=this.epoch;
  this.confirm.ask({title:'Activar revisiones',message:'Se conservará el contenido actual. Desde este momento sólo la última revisión aceptada podrá crear pedido o venta. Las autorizaciones internas de precios/crédito se siguen comprobando.',confirmLabel:'Activar revisiones'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(!ok||epoch!==this.epoch)return;
   try{const body={motivo:this.motive.value.trim()},requestId=this.intents.begin('sellar',body);this.busy.set(true);this.api.seal(this.id,{...body,requestId}).pipe(finalize(()=>{if(epoch===this.epoch)this.busy.set(false);}),takeUntilDestroyed(this.destroy)).subscribe({next:()=>{if(epoch!==this.epoch)return;this.intents.success('sellar');this.busy.set(false);this.load();},error:e=>{if(epoch===this.epoch){this.intents.failure('sellar',e.status);this.error.set(this.message(e));}}});}catch(e){this.error.set(e instanceof Error?e.message:'Revisa los datos.');}
  });
 }
 invite(){if(this.busy()||this.loading())return;const epoch=this.epoch,requestId=this.intents.begin('enlace',{});this.busy.set(true);this.error.set('');
  this.api.invite(this.id,requestId).pipe(finalize(()=>{if(epoch===this.epoch)this.busy.set(false);}),takeUntilDestroyed(this.destroy)).subscribe({next:value=>{if(epoch!==this.epoch)return;this.intents.success('enlace');this.link.set(location.origin+'/cotizaciones/responder#token='+value.token);this.expires.set(value.venceEn);this.busy.set(false);this.load();},error:e=>{if(epoch===this.epoch){this.intents.failure('enlace',e.status);this.error.set(this.message(e));}}});
 }
 revoke(id:number){if(this.busy()||this.loading())return;const epoch=this.epoch;this.prompt.ask({title:'Revocar enlace',message:'Impedirá nuevas consultas y respuestas desde ese enlace. Una respuesta ya recibida se conserva.',label:'Motivo de revocación',confirmLabel:'Revocar'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(motivo=>{if(!motivo||epoch!==this.epoch)return;this.busy.set(true);this.api.revoke(this.id,id,motivo).pipe(finalize(()=>{if(epoch===this.epoch)this.busy.set(false);}),takeUntilDestroyed(this.destroy)).subscribe({next:()=>{if(epoch!==this.epoch)return;this.link.set('');this.busy.set(false);this.load();},error:e=>{if(epoch===this.epoch)this.error.set(this.message(e));}});});}
}
