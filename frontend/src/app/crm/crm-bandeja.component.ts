import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs';
import { CrmService } from '../services/crm.service';
import { CommercialFilters, CommercialInbox, CommercialItem, CrmBandejaService } from './crm-bandeja.service';
@Component({selector:'app-crm-bandeja',standalone:true,imports:[CommonModule,FormsModule,RouterLink,MatButtonModule],
 templateUrl:'./crm-bandeja.component.html',styleUrls:['./campanas-locales-form.css','./crm-bandeja.component.css']})
export class CrmBandejaComponent {
 private readonly api=inject(CrmBandejaService);private readonly crm=inject(CrmService);
 private readonly destroy=inject(DestroyRef);private readonly dialog=inject(MatDialog);
 private readonly router=inject(Router);private readonly route=inject(ActivatedRoute);
 readonly result=signal<CommercialInbox|null>(null);readonly busy=signal(false);readonly opening=signal(false);readonly error=signal('');
 readonly labels:Record<string,string>={tarea:'Tarea',oportunidad:'Oportunidad',cotizacion:'Cotización',web:'Solicitud web',vencidas:'Vencida',hoy:'Hoy',proximas:'Próximos 7 días','sin-fecha':'Sin fecha',posteriores:'Posterior'};
 filters:CommercialFilters={q:'',tipo:'todos',plazo:'todos'};private applied={...this.filters};page=1;
 private readonly formatter=new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'short',timeStyle:'short'});
 date(value:string){return this.formatter.format(new Date(value));}
 constructor(){const q=this.route.snapshot.queryParamMap;this.filters={q:(q.get('q')??'').slice(0,100),tipo:['tarea','oportunidad','cotizacion','web'].includes(q.get('tipo')??'')?q.get('tipo')!:'todos',plazo:['vencidas','hoy','proximas','sin-fecha'].includes(q.get('plazo')??'')?q.get('plazo')!:'todos'};
  const page=Number(q.get('page'));this.page=Number.isInteger(page)&&page>0&&page<=100000?page:1;this.applied={...this.filters};this.load();}
 apply(){if(this.busy())return;this.page=1;this.applied={...this.filters,q:this.filters.q.trim()};this.load();}
 paginate(delta:number){if(this.busy())return;this.page+=delta;this.load();}
 load(){if(this.busy())return;this.busy.set(true);this.error.set('');this.result.set(null);
  void this.router.navigate([],{relativeTo:this.route,queryParams:{...this.applied,page:this.page},replaceUrl:true});
  this.api.list(this.page,this.applied).pipe(finalize(()=>this.busy.set(false)),takeUntilDestroyed(this.destroy)).subscribe({next:r=>this.result.set(r),error:(e:unknown)=>this.error.set(e instanceof HttpErrorResponse&&e.status===403?'No tienes acceso a esa fuente. Selecciona tareas u oportunidades.':'No se pudo cargar la bandeja. Vuelve a intentarlo.')});
 }
 async openOpportunity(item:CommercialItem){if(this.opening())return;this.opening.set(true);this.error.set('');
  try{const {CrmOportunidadDialogComponent}=await import('./crm-oportunidad-dialog.component');if(this.destroy.destroyed)return;
   this.crm.getOportunidad(Number(item.id)).pipe(finalize(()=>this.opening.set(false)),takeUntilDestroyed(this.destroy)).subscribe({next:o=>{
    this.dialog.open(CrmOportunidadDialogComponent,{width:'860px',maxWidth:'96vw',data:o,disableClose:true}).afterClosed().pipe(takeUntilDestroyed(this.destroy)).subscribe(changed=>{if(changed)this.load();});
   },error:()=>this.error.set('La oportunidad ya no está disponible. Actualiza la bandeja.')});
  }catch{this.opening.set(false);this.error.set('No se pudo abrir la oportunidad. Reintenta.');}
 }
}
