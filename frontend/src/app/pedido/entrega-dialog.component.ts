import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { finalize } from 'rxjs';
import { EntregaEstado, PedidoService } from '../services/pedido.service';
import { downloadDocument } from '../shared/document-download';
@Component({selector:'app-entrega-dialog',standalone:true,imports:[CommonModule,FormsModule,MatDialogModule,MatButtonModule],templateUrl:'./entrega-dialog.component.html',styleUrl:'./entrega-dialog.component.css'})
export class EntregaDialogComponent {
 private readonly service=inject(PedidoService);private readonly ref=inject(MatDialogRef<EntregaDialogComponent>);private readonly destroy=inject(DestroyRef);
 readonly id=inject<number>(MAT_DIALOG_DATA);readonly state=signal<EntregaEstado|null>(null);readonly busy=signal(false);readonly locating=signal(false);readonly error=signal('');readonly locationError=signal('');
 @ViewChild('canvas') canvas?:ElementRef<HTMLCanvasElement>;
 @ViewChild('signatureInput') signatureInput?:ElementRef<HTMLInputElement>;
 recibidoPor='';notas='';motivo='';confirmacion=false;firmada=false;firma:File|null=null;foto:File|null=null;
 ubicacion:{latitud:number;longitud:number;precision:number;fecha:string}|null=null;
 private drawing=false;private changed=false;private intent='';private requestId='';private locationGeneration=0;
 constructor(){this.load();this.destroy.onDestroy(()=>{this.locationGeneration++;});}
 load(){this.busy.set(true);this.error.set('');this.service.delivery(this.id).pipe(finalize(()=>this.busy.set(false)),takeUntilDestroyed(this.destroy)).subscribe({next:s=>this.state.set(s),error:e=>this.fail(e)});}
 private fail(e:unknown){const payload:unknown=e instanceof HttpErrorResponse?e.error:null;this.error.set(payload&&typeof payload==='object'&&'message'in payload&&typeof payload.message==='string'?payload.message:'No se pudo completar la operación. Actualiza o reintenta con los mismos datos.');}
 select(event:Event,kind:'firma'|'foto'){
  const input=event.target as HTMLInputElement,file=input.files?.[0]??null;this.error.set('');
  if(file&&(file.size>(kind==='firma'?512*1024:5*1024*1024)||!(kind==='firma'?['image/png']:['image/png','image/jpeg','image/webp']).includes(file.type))){this.error.set('Firma: PNG hasta512KiB. Foto: JPEG, PNG o WebP hasta5MiB.');input.value='';return;}
  if(kind==='firma')this.firma=file;else this.foto=file;
 }
 pointer(event:PointerEvent,start=false){
  if(this.busy()||this.firma||(!start&&!this.drawing)||(!event.isPrimary))return;const canvas=this.canvas?.nativeElement,ctx=canvas?.getContext('2d');if(!canvas||!ctx)return;
  const box=canvas.getBoundingClientRect(),x=(event.clientX-box.left)*canvas.width/box.width,y=(event.clientY-box.top)*canvas.height/box.height;
  if(start){this.drawing=true;canvas.setPointerCapture(event.pointerId);ctx.beginPath();ctx.moveTo(x,y);}else{ctx.lineWidth=2;ctx.lineCap='round';ctx.strokeStyle='#14243b';ctx.lineTo(x,y);ctx.stroke();this.firmada=true;}
 }
 stop(){this.drawing=false;}
 clear(){if(this.busy())return;this.canvas?.nativeElement.getContext('2d')?.clearRect(0,0,600,180);if(this.signatureInput)this.signatureInput.nativeElement.value='';this.firmada=false;this.firma=null;this.drawing=false;}
 locate(){if(this.locating()||this.busy())return;this.locationError.set('');if(!navigator.geolocation){this.locationError.set('Tu navegador no ofrece ubicación. Puedes continuar sin ella.');return;}
  this.locating.set(true);const generation=++this.locationGeneration;
  navigator.geolocation.getCurrentPosition(p=>{if(this.destroy.destroyed||generation!==this.locationGeneration)return;this.locating.set(false);this.ubicacion={latitud:p.coords.latitude,longitud:p.coords.longitude,precision:p.coords.accuracy,fecha:new Date(p.timestamp).toISOString()};},()=>{if(this.destroy.destroyed||generation!==this.locationGeneration)return;this.locating.set(false);this.locationError.set('No se obtuvo permiso o señal. Puedes continuar sin ubicación.');},{enableHighAccuracy:true,timeout:10000,maximumAge:0});
 }
 removeLocation(){this.locationGeneration++;this.locating.set(false);this.ubicacion=null;this.locationError.set('');}
 async submit(){
  if(this.busy()||this.locating()||!this.state()||!this.recibidoPor.trim()||!this.confirmacion)return;
  if(!this.firma&&!this.firmada&&!this.foto&&!this.motivo.trim()){this.error.set('Adjunta firma/foto o explica por qué no se recabó evidencia.');return;}
  this.busy.set(true);this.ref.disableClose=true;this.error.set('');
  try{
   const signature=this.firma??(this.firmada&&this.canvas?await new Promise<Blob|null>(resolve=>this.canvas!.nativeElement.toBlob(resolve,'image/png')):null);
   if(this.firmada&&!signature)throw new Error('Firma no disponible');
   const fileKey=(file:File|null)=>file?[file.name,file.size,file.lastModified]:null;
   const intent=JSON.stringify([this.recibidoPor.trim(),this.notas.trim(),this.motivo.trim(),this.ubicacion,fileKey(this.firma),fileKey(this.foto),this.firmada?this.canvas?.nativeElement.toDataURL():null]);
   if(intent!==this.intent){this.intent=intent;this.requestId=crypto.randomUUID();}
   const body=new FormData();body.set('requestId',this.requestId);body.set('version',String(this.state()!.version));body.set('recibidoPor',this.recibidoPor.trim());body.set('notas',this.notas.trim());body.set('motivoSinEvidencia',this.motivo.trim());body.set('confirmacion','true');
   if(this.ubicacion){body.set('latitud',String(this.ubicacion.latitud));body.set('longitud',String(this.ubicacion.longitud));body.set('precision',String(this.ubicacion.precision));body.set('ubicacionFecha',this.ubicacion.fecha);}
   if(signature)body.set('firma',signature,'firma.png');if(this.foto)body.set('foto',this.foto,this.foto.name);
   let refresh=false;
   this.service.evidenceDelivery(this.id,body).pipe(finalize(()=>{this.busy.set(false);this.ref.disableClose=false;if(refresh&&!this.destroy.destroyed)this.load();}),takeUntilDestroyed(this.destroy)).subscribe({next:()=>{this.changed=true;refresh=true;},error:e=>this.fail(e)});
  }catch{this.busy.set(false);this.ref.disableClose=false;this.error.set('No se pudo preparar la firma. Vuelve a capturarla.');}
 }
 download(kind:'firma'|'foto'|'comprobante'){
  if(this.busy())return;this.busy.set(true);this.error.set('');
  (kind==='comprobante'?this.service.deliveryReceipt(this.id):this.service.deliveryFile(this.id,kind)).pipe(finalize(()=>this.busy.set(false)),takeUntilDestroyed(this.destroy)).subscribe({next:blob=>downloadDocument(blob,`pedido-${this.id}-${kind}.${kind==='comprobante'?'pdf':blob.type==='image/jpeg'?'jpg':blob.type==='image/webp'?'webp':'png'}`),error:e=>this.fail(e)});
 }
 close(){if(!this.busy())this.ref.close(this.changed);}
}
