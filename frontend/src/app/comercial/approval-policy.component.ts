import { Component,inject,signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder,ReactiveFormsModule,Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { finalize } from 'rxjs';
import { ComercialService,OperacionComercial,PoliticaAprobaciones,ReglaAprobacion } from '../services/comercial.service';

export function commercialError(error:unknown):string{
  if(error instanceof HttpErrorResponse){const message=error.error?.message;
    if(typeof message==='string')return message;if(Array.isArray(message))return message.join('. ');
  }
  return 'No se pudo completar la operación. Revisa tu conexión y reintenta.';
}
@Component({selector:'app-approval-policy',standalone:true,
 imports:[CommonModule,ReactiveFormsModule,MatButtonModule,MatCheckboxModule,MatFormFieldModule,MatInputModule,MatSelectModule],
 templateUrl:'./approval-policy.component.html',styleUrl:'./approval-policy.component.css'})
export class ApprovalPolicyComponent{
 private readonly api=inject(ComercialService);private readonly fb=inject(FormBuilder);
 readonly data=signal<PoliticaAprobaciones|null>(null);readonly loading=signal(false);readonly busy=signal(false);
 readonly error=signal('');readonly message=signal('');readonly selected=signal<ReglaAprobacion|null>(null);
 readonly operations:OperacionComercial[]=['Venta','Pedido','Cotizacion'];
 readonly rule=this.fb.group({montoMaximo:this.fb.control<number|null>(null,[Validators.min(0),Validators.max(999999999999)]),requiereDistinto:false,
   vigenciaMaximaHoras:[24,[Validators.required,Validators.min(1),Validators.max(720)]],motivo:['',[Validators.required,Validators.maxLength(1000)]]});
 readonly authority=this.fb.group({idUsuario:[0,[Validators.required,Validators.min(1)]],operacion:this.fb.nonNullable.control<OperacionComercial>('Venta'),
   montoMaximo:this.fb.control<number|null>(null,[Validators.min(0),Validators.max(999999999999)]),motivo:['',[Validators.required,Validators.maxLength(1000)]]});
 constructor(){this.load();}
 load(){if(this.busy())return;this.loading.set(true);this.error.set('');this.selected.set(null);this.data.set(null);
   this.api.politicaAprobaciones().pipe(finalize(()=>this.loading.set(false))).subscribe({next:value=>this.data.set(value),error:e=>this.error.set(commercialError(e))});}
 edit(rule:ReglaAprobacion){this.selected.set(rule);this.error.set('');this.message.set('');this.rule.reset({montoMaximo:rule.montoMaximo===null?null:Number(rule.montoMaximo),requiereDistinto:rule.requiereDistinto,vigenciaMaximaHoras:rule.vigenciaMaximaHoras,motivo:''});}
 saveRule(){const selected=this.selected();if(!selected||this.rule.invalid||this.busy()||this.loading())return;
   this.busy.set(true);this.error.set('');this.api.guardarRegla({...this.rule.getRawValue(),operacion:selected.operacion,tipo:selected.tipo,version:selected.version})
     .pipe(finalize(()=>this.busy.set(false))).subscribe({next:()=>{this.message.set('Regla guardada. Las aprobaciones de versiones anteriores requieren una nueva solicitud.');this.busy.set(false);this.load();},error:e=>this.error.set(commercialError(e))});}
 selectAuthority(){const {idUsuario,operacion}=this.authority.getRawValue();const row=this.data()?.limites.find(x=>x.idUsuario===idUsuario&&x.operacion===operacion);
   this.authority.patchValue({montoMaximo:row?.montoMaximo==null?null:Number(row.montoMaximo),motivo:''});}
 saveAuthority(){if(this.authority.invalid||this.busy()||this.loading()||!this.data())return;const value=this.authority.getRawValue();
   const version=this.data()!.limites.find(x=>x.idUsuario===value.idUsuario&&x.operacion===value.operacion)?.version??0;
   this.busy.set(true);this.error.set('');this.api.guardarLimite(value.idUsuario!,{operacion:value.operacion,montoMaximo:value.montoMaximo,motivo:value.motivo,version})
     .pipe(finalize(()=>this.busy.set(false))).subscribe({next:()=>{this.message.set('Límite guardado. También se comprueba al utilizar la autorización.');this.busy.set(false);this.load();},error:e=>this.error.set(commercialError(e))});}
}
