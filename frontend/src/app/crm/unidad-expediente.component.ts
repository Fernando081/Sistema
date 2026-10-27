import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component,DestroyRef,ElementRef,ViewChild,inject,signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder,ReactiveFormsModule,Validators } from '@angular/forms';
import { ActivatedRoute,RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Observable,finalize } from 'rxjs';
import { UnidadArchivo,UnidadExpediente,UnidadExpedienteService,UnidadMantenimiento } from '../services/unidad-expediente.service';
import { TextPromptService } from '../shared/text-prompt.service';
import { ConfirmService } from '../shared/confirm.service';
import { downloadDocument } from '../shared/document-download';
import { UnidadPiezasComponent } from './unidad-piezas.component';
const localTime=()=>{const date=new Date();return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19);};
@Component({selector:'app-unidad-expediente',standalone:true,
 imports:[CommonModule,RouterLink,ReactiveFormsModule,MatButtonModule,MatFormFieldModule,MatInputModule,MatSelectModule,UnidadPiezasComponent],
 templateUrl:'./unidad-expediente.component.html',styleUrl:'./unidad-expediente.component.css'})
export class UnidadExpedienteComponent{
 private readonly api=inject(UnidadExpedienteService);private readonly fb=inject(FormBuilder);private readonly route=inject(ActivatedRoute);
 private readonly destroy=inject(DestroyRef);private readonly prompt=inject(TextPromptService);private readonly confirm=inject(ConfirmService);
 id=0;lecturasPage=1;mantenimientosPage=1;private loadRevision=0;
 readonly data=signal<UnidadExpediente|null>(null);readonly loading=signal(false);readonly busy=signal(false);readonly error=signal('');readonly message=signal('');
 readonly closing=signal<UnidadMantenimiento|null>(null);readonly file=signal<File|null>(null);readonly photos=signal<Record<number,string>>({});readonly pending=signal(false);
 private readonly intents=new Map<string,{signature:string;key:string}>();
 @ViewChild('fileInput')private fileInput?:ElementRef<HTMLInputElement>;
 readonly reading=this.fb.group({fecha:[localTime(),Validators.required],kilometraje:this.fb.control<number|null>(null,[Validators.min(0),Validators.max(999999999999)]),horas:this.fb.control<number|null>(null,[Validators.min(0),Validators.max(999999999999)]),notas:['',Validators.maxLength(1000)]});
 readonly plan=this.fb.group({titulo:['',[Validators.required,Validators.maxLength(150)]],notas:['',Validators.maxLength(1000)],fechaObjetivo:[''],kilometrajeObjetivo:this.fb.control<number|null>(null,[Validators.min(0),Validators.max(999999999999)]),horasObjetivo:this.fb.control<number|null>(null,[Validators.min(0),Validators.max(999999999999)])});
 readonly closeForm=this.fb.nonNullable.group({estado:['Realizado' as 'Realizado'|'Cancelado'],fecha:[localTime()],motivo:['',[Validators.required,Validators.maxLength(1000)]]});
 readonly attachment=this.fb.nonNullable.group({titulo:['',[Validators.required,Validators.maxLength(150)]]});
 constructor(){
  this.destroy.onDestroy(()=>this.clearPhotos());
  this.route.paramMap.pipe(takeUntilDestroyed(this.destroy)).subscribe(params=>{this.id=Number(params.get('id'));this.lecturasPage=1;this.mantenimientosPage=1;this.intents.clear();this.pending.set(false);this.closing.set(null);this.busy.set(false);this.message.set('');this.data.set(null);
   this.reading.reset({fecha:localTime(),kilometraje:null,horas:null,notas:''});this.plan.reset({titulo:'',notas:'',fechaObjetivo:'',kilometrajeObjetivo:null,horasObjetivo:null});this.attachment.reset({titulo:''});this.file.set(null);this.load();});
 }
 private clearPhotos(){for(const url of Object.values(this.photos()))URL.revokeObjectURL(url);this.photos.set({});}
 load(){const revision=++this.loadRevision;this.loading.set(true);this.error.set('');this.clearPhotos();
  this.api.get(this.id,this.lecturasPage,this.mantenimientosPage).pipe(finalize(()=>{if(revision===this.loadRevision)this.loading.set(false);}),takeUntilDestroyed(this.destroy)).subscribe({next:value=>{if(revision===this.loadRevision)this.data.set(value);},error:e=>{if(revision===this.loadRevision){this.data.set(null);this.error.set(this.errorMessage(e));}}});}
 private errorMessage(error:unknown){if(error instanceof HttpErrorResponse){const value=error.error?.message;if(typeof value==='string')return value;if(Array.isArray(value))return value.join('. ');}return 'No se pudo completar la operación. Revisa tu conexión y reintenta.';}
 private key(kind:string,payload:unknown){const signature=JSON.stringify(payload),previous=this.intents.get(kind);
  if(previous&&previous.signature!==signature)throw new Error('Hay un envío pendiente con otros datos. Revisa el historial antes de preparar otro registro.');
  const value=previous??{signature,key:crypto.randomUUID()};this.intents.set(kind,value);this.pending.set(true);return value.key;
 }
 private mutate(kind:string,request:Observable<unknown>,success:()=>void){const id=this.id;this.busy.set(true);this.error.set('');this.message.set('');
  request.pipe(finalize(()=>{if(this.id===id)this.busy.set(false);}),takeUntilDestroyed(this.destroy)).subscribe({next:()=>{if(this.id!==id)return;this.intents.delete(kind);this.pending.set(this.intents.size>0);success();this.message.set('Registro guardado en el expediente.');this.load();},error:e=>{
   if(this.id!==id)return;if(e instanceof HttpErrorResponse&&e.status>=400&&e.status<500){this.intents.delete(kind);this.pending.set(this.intents.size>0);}this.error.set(this.errorMessage(e));}});
 }
 saveReading(){if(this.reading.invalid||this.busy()||this.loading())return;const raw=this.reading.getRawValue();
  if(raw.kilometraje===null&&raw.horas===null){this.error.set('Captura kilometraje, horas o ambos.');return;}
  try{const body={...raw,fecha:new Date(raw.fecha!).toISOString(),notas:raw.notas?.trim()||''};const key=this.key('lectura',body);
   this.mutate('lectura',this.api.lectura(this.id,{...body,requestId:key}),()=>this.reading.reset({fecha:localTime(),kilometraje:null,horas:null,notas:''}));
  }catch(e){this.error.set(e instanceof Error?e.message:'Revisa la fecha.');}
 }
 savePlan(){if(this.plan.invalid||this.busy()||this.loading())return;const raw=this.plan.getRawValue();
  if(!raw.fechaObjetivo&&raw.kilometrajeObjetivo===null&&raw.horasObjetivo===null){this.error.set('Indica al menos una fecha, kilometraje u horas objetivo.');return;}
  try{const body={...raw,titulo:raw.titulo?.trim(),notas:raw.notas?.trim()||'',fechaObjetivo:raw.fechaObjetivo||null};const key=this.key('plan',body);
   this.mutate('plan',this.api.mantenimiento(this.id,{...body,requestId:key}),()=>this.plan.reset({titulo:'',notas:'',fechaObjetivo:'',kilometrajeObjetivo:null,horasObjetivo:null}));
  }catch(e){this.error.set(e instanceof Error?e.message:'Revisa el mantenimiento.');}
 }
 closePlan(plan:UnidadMantenimiento){this.closing.set(plan);this.closeForm.reset({estado:'Realizado',fecha:localTime(),motivo:''});}
 saveClose(){const plan=this.closing();if(!plan||this.closeForm.invalid||this.busy()||this.loading())return;const raw=this.closeForm.getRawValue();
  try{const fecha=raw.estado==='Realizado'?new Date(raw.fecha).toISOString():undefined;
   this.mutate('cierre',this.api.cerrar(this.id,plan.idMantenimiento,{estado:raw.estado,version:plan.version,motivo:raw.motivo.trim(),fechaRealizada:fecha}),()=>this.closing.set(null));
  }catch{this.error.set('Indica una fecha de realización válida.');}
 }
 selectFile(event:Event){const value=(event.target as HTMLInputElement).files?.[0]??null;this.file.set(value);}
 upload(){const file=this.file();if(!file||this.attachment.invalid||this.busy()||this.loading())return;
  if(file.size>5*1024*1024){this.error.set('El archivo supera5MiB.');return;}
  try{const title=this.attachment.controls.titulo.value.trim(),key=this.key('archivo',{titulo:title,nombre:file.name,size:file.size,lastModified:file.lastModified});
   this.mutate('archivo',this.api.subir(this.id,key,title,file),()=>{this.attachment.reset({titulo:''});this.file.set(null);if(this.fileInput)this.fileInput.nativeElement.value='';});
  }catch(e){this.error.set(e instanceof Error?e.message:'Revisa el archivo.');}
 }
 view(file:UnidadArchivo,preview=false){if(this.busy()||this.loading())return;const id=this.id;this.busy.set(true);this.error.set('');
  this.api.archivo(id,file.idArchivo).pipe(finalize(()=>{if(this.id===id)this.busy.set(false);}),takeUntilDestroyed(this.destroy)).subscribe({next:blob=>{
   if(this.id!==id)return;if(preview&&file.tipo==='Foto'){const old=this.photos()[file.idArchivo];if(old)URL.revokeObjectURL(old);this.photos.update(value=>({...value,[file.idArchivo]:URL.createObjectURL(blob)}));}
   else{const extension=({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'} as Record<string,string>)[file.mime];downloadDocument(blob,`unidad-${id}-archivo-${file.idArchivo}.${extension}`);}},error:e=>this.error.set(this.errorMessage(e))});
 }
 annotate(kind:'lectura'|'archivo',id:number){if(this.busy()||this.loading())return;this.prompt.ask({title:kind==='lectura'?'Anular lectura':'Retirar archivo',message:'El registro se conserva en el historial. Indica el motivo de esta corrección.',label:'Motivo de la corrección',confirmLabel:'Confirmar'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(motivo=>{
   if(!motivo)return;this.mutate('correccion',kind==='lectura'?this.api.anular(this.id,id,motivo):this.api.retirar(this.id,id,motivo),()=>{});});}
 next(kind:'lectura'|'plan',delta:number){if(this.busy()||this.loading())return;if(kind==='lectura')this.lecturasPage+=delta;else this.mantenimientosPage+=delta;this.load();}
 resetIntent(){this.confirm.ask({title:'Preparar otro registro',message:'Confirma que revisaste el historial y los archivos para comprobar si el envío pendiente sí quedó registrado.',confirmLabel:'Ya revisé el expediente'}).pipe(takeUntilDestroyed(this.destroy)).subscribe(confirmed=>{if(confirmed){this.intents.clear();this.pending.set(false);this.error.set('');}});}
}
