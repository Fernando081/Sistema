import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, finalize, forkJoin } from 'rxjs';
import { ConfirmService } from '../shared/confirm.service';
import { AlmacenMovilService, MobileDetail, MobileEvent, MobileOrder, MobilePick, VerifyPicking } from './almacen-movil.service';
interface Detector {detect(source:HTMLVideoElement):Promise<Array<{rawValue:string}>>;}
interface DetectorConstructor {new(options:{formats:string[]}):Detector;getSupportedFormats():Promise<string[]>;}
@Component({selector:'app-almacen-movil',standalone:true,imports:[CommonModule,FormsModule,ReactiveFormsModule,RouterLink,MatButtonModule],templateUrl:'./almacen-movil.component.html',styleUrls:['../crm/campanas-locales-form.css','./almacen-movil.component.css']})
export class AlmacenMovilComponent {
 private readonly api=inject(AlmacenMovilService);private readonly destroy=inject(DestroyRef);private readonly confirm=inject(ConfirmService);
 private readonly route=inject(ActivatedRoute);private readonly router=inject(Router);private readonly intents=new Map<string,string>();
 @ViewChild('scanVideo') video?:ElementRef<HTMLVideoElement>;
 readonly orders=signal<MobileOrder[]>([]);readonly detail=signal<MobileDetail|null>(null);readonly events=signal<MobileEvent[]>([]);readonly selected=signal<MobilePick|null>(null);
 readonly busy=signal(false);readonly error=signal('');readonly notice=signal('');readonly cameraActive=signal(false);readonly cameraPending=signal(false);readonly cameraError=signal('');
 page=1;total=0;q='';estado='pendientes';pickPage=1;historyPage=1;historyTotal=0;producto='';ubicacion='';cantidad='';metodo='Manual';readonly reviewControl=new FormControl(false,{nonNullable:true});motivo='';private selectedOrder=0;
 private stream:MediaStream|null=null;private cameraGeneration=0;private timer:ReturnType<typeof setTimeout>|undefined;private field:'producto'|'ubicacion'='ubicacion';
 private readonly visibility=()=>{if(document.hidden)this.stopCamera();};
 private readonly formatter=new Intl.DateTimeFormat('es-MX',{timeZone:'America/Mexico_City',dateStyle:'short',timeStyle:'short'});
 date(v:string){return this.formatter.format(new Date(v));}
 constructor(){document.addEventListener('visibilitychange',this.visibility);this.destroy.onDestroy(()=>{this.stopCamera();document.removeEventListener('visibilitychange',this.visibility);});
  const id=Number(this.route.snapshot.queryParamMap.get('pedido'));if(Number.isInteger(id)&&id>0&&id<=2147483647)this.open(id);else this.load();}
 private request<T>(source:Observable<T>,next:(value:T)=>void,after?:()=>void){if(this.busy())return;this.busy.set(true);this.error.set('');let ok=false;
  source.pipe(finalize(()=>{this.busy.set(false);if(ok&&!this.destroy.destroyed)after?.();}),takeUntilDestroyed(this.destroy)).subscribe({next:v=>{next(v);ok=true;},error:(e:unknown)=>{
   const body:unknown=e instanceof HttpErrorResponse?e.error:null,msg=body&&typeof body==='object'&&'message'in body?body.message:null;this.error.set(typeof msg==='string'?msg:Array.isArray(msg)?msg.join('. '):'No se pudo completar. Consulta el historial antes de repetir una verificación.');
  }});
 }
 private intent(key:string){let id=this.intents.get(key);if(!id){id=crypto.randomUUID();this.intents.set(key,id);}return id;}
 load(delta=0){if(this.busy())return;this.page=delta?this.page+delta:1;this.orders.set([]);this.request(this.api.list(this.page,this.q.trim(),this.estado),r=>{this.orders.set(r.data);this.total=r.total;});}
 open(id:number,delta=0){if(this.busy())return;this.stopCamera();this.selectedOrder=id;this.selected.set(null);this.reviewControl.setValue(false);this.pickPage=delta?this.pickPage+delta:1;this.historyPage=1;this.detail.set(null);this.events.set([]);
  void this.router.navigate([],{relativeTo:this.route,queryParams:{pedido:id},replaceUrl:true});
  this.request(forkJoin({detail:this.api.detail(id,this.pickPage),history:this.api.history(id,1)}),r=>{this.detail.set(r.detail);this.events.set(r.history.data);this.historyTotal=r.history.total;});
 }
 back(){if(this.busy())return;this.stopCamera();this.selectedOrder=0;this.selected.set(null);this.detail.set(null);this.events.set([]);void this.router.navigate([],{relativeTo:this.route,queryParams:{},replaceUrl:true});this.load();}
 refresh(){if(this.selectedOrder)this.open(this.selectedOrder);else this.load();}
 choose(p:MobilePick){this.stopCamera();this.selected.set(p);this.producto='';this.ubicacion='';this.cantidad=p.pendiente;this.metodo='Manual';this.reviewControl.setValue(false);this.error.set('');this.notice.set('');requestAnimationFrame(()=>{if(!this.destroy.destroyed)document.getElementById('scan-location')?.focus();});}
 productMatches(){const p=this.selected();return !!p&&[p.codigo,`RTT1:P:${p.idProducto}`].includes(this.producto.trim());}
 locationMatches(){const p=this.selected();return !!p&&[`${p.almacen}/${p.ubicacion}`,`RTT1:U:${p.idUbicacion}`].includes(this.ubicacion.trim());}
 valid(){return this.productMatches()&&this.locationMatches()&&/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(this.cantidad)&&Number(this.cantidad)>0&&this.reviewControl.value;}
 verify(){const p=this.selected();if(!p||!this.valid()||this.busy())return;this.stopCamera();const values={idSurtido:p.id,evaluacionSha256:p.evaluacionSha256,producto:this.producto.trim(),ubicacion:this.ubicacion.trim(),cantidad:this.cantidad,metodo:this.metodo,confirmacion:true as const},key=JSON.stringify({pedido:this.selectedOrder,...values}),dto:VerifyPicking={requestId:this.intent(key),...values};
  this.confirm.ask({title:'Confirmar recogida',message:`${this.cantidad} de ${p.codigo} en ${p.almacen}/${p.ubicacion}. Se conservará la verificación; no descuenta inventario ni entrega el pedido.`,confirmLabel:'Guardar verificación'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.verify(this.selectedOrder,dto),()=>{this.intents.delete(key);this.notice.set('Verificación guardada.');},()=>this.open(this.selectedOrder));});
 }
 canCancel(e:MobileEvent){const d=this.detail();return !!d&&['Parcialmente surtido','Surtido'].includes(d.pedido.estado)&&e.accion==='Verificar'&&!e.anulada&&(d.administrador||e.actor===d.idUsuario);}
 cancel(e:MobileEvent){if(!this.canCancel(e)||!this.motivo.trim()||this.busy())return;const motivo=this.motivo.trim(),key=JSON.stringify({pedido:this.selectedOrder,anular:e.id,motivo});
  this.confirm.ask({title:'Anular verificación',message:'Se conservará la corrección y volverá a quedar cantidad por verificar. No modifica inventario.',confirmLabel:'Anular verificación'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(ok=>{if(ok)this.request(this.api.cancel(this.selectedOrder,this.intent(key),e.id,motivo),()=>{this.intents.delete(key);this.motivo='';this.notice.set('Verificación anulada; el historial se conserva.');},()=>this.open(this.selectedOrder));});
 }
 history(delta:number){if(this.busy())return;this.historyPage+=delta;this.events.set([]);this.request(this.api.history(this.selectedOrder,this.historyPage),r=>{this.events.set(r.data);this.historyTotal=r.total;});}
 label(p:MobilePick,kind:'producto'|'ubicacion'){this.request(this.api.label(kind,kind==='producto'?p.idProducto:p.idUbicacion),blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`etiqueta-${kind}.pdf`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
 async startCamera(field:'producto'|'ubicacion'){
  if(this.busy()||!this.selected())return;this.stopCamera();this.field=field;this.cameraError.set('');
  const ctor=(globalThis as typeof globalThis&{BarcodeDetector?:DetectorConstructor}).BarcodeDetector;
  if(!globalThis.isSecureContext||!navigator.mediaDevices?.getUserMedia||!ctor){this.cameraError.set('La cámara requiere conexión segura y un navegador con lector compatible. Puedes usar lector de teclado o captura manual.');return;}
  const generation=++this.cameraGeneration;this.cameraPending.set(true);
  try{const formats=(await ctor.getSupportedFormats()).filter(f=>['qr_code','code_128','code_39','ean_13','ean_8','upc_a','itf'].includes(f));if(generation!==this.cameraGeneration)return;if(!formats.length)throw new Error('Unsupported');
   const detector=new ctor({formats}),stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280}}});
   if(generation!==this.cameraGeneration||this.destroy.destroyed){stream.getTracks().forEach(t=>t.stop());return;}
   this.stream=stream;const video=this.video?.nativeElement;if(!video)throw new Error('VideoMissing');video.srcObject=stream;this.cameraActive.set(true);await video.play();
   if(generation!==this.cameraGeneration)return;
   const scan=async()=>{if(generation!==this.cameraGeneration)return;try{const found=await detector.detect(video);if(generation!==this.cameraGeneration)return;
    const value=found.find(v=>v.rawValue?.trim()&&v.rawValue.length<=160)?.rawValue.trim();if(value){if(this.field==='producto')this.producto=value;else this.ubicacion=value;this.metodo='Camara';this.reviewControl.setValue(false);this.stopCamera();this.notice.set('Código leído. Revisa la coincidencia antes de confirmar.');return;}
   }catch{if(generation===this.cameraGeneration){this.stopCamera();this.cameraError.set('No se pudo leer la cámara. Usa lector o captura manual.');}return;}this.timer=setTimeout(()=>void scan(),250);};void scan();
  }catch{if(generation===this.cameraGeneration){this.stopCamera();this.cameraError.set('No se pudo iniciar la cámara. Revisa su permiso o usa lector/captura manual.');}}
  finally{if(generation===this.cameraGeneration)this.cameraPending.set(false);}
 }
 stopCamera(){this.cameraGeneration++;if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;if(this.video?.nativeElement)this.video.nativeElement.srcObject=null;this.cameraActive.set(false);this.cameraPending.set(false);this.cameraError.set('');}
}
