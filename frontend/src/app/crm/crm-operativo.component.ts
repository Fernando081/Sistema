import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { catchError, forkJoin, of } from 'rxjs';
import { AuthService, AuthUser } from '../auth/auth.service';
import { Cliente } from '../cliente/cliente.interface';
import { ClienteService } from '../services/cliente.service';
import { CrmCampana, CrmComunicacion, CrmEncuesta, CrmMeta, CrmPlantilla, CrmSegmento, CrmService, CrmTarea, CrmTaskStatus } from '../services/crm.service';
import { NotificationService } from '../shared/notification.service';

@Component({selector:'app-crm-operativo',standalone:true,imports:[CommonModule,ReactiveFormsModule,MatButtonModule,MatCardModule,MatFormFieldModule,MatInputModule,MatSelectModule],templateUrl:'./crm-operativo.component.html',styleUrl:'./crm-operativo.component.css'})
export class CrmOperativoComponent{
 private readonly api=inject(CrmService);private readonly clientsApi=inject(ClienteService);private readonly auth=inject(AuthService);private readonly fb=inject(FormBuilder);private readonly notice=inject(NotificationService);
 readonly segmentos=signal<CrmSegmento[]>([]);readonly plantillas=signal<CrmPlantilla[]>([]);readonly campanas=signal<CrmCampana[]>([]);readonly encuestas=signal<CrmEncuesta[]>([]);readonly metas=signal<CrmMeta[]>([]);readonly tareas=signal<CrmTarea[]>([]);readonly comunicaciones=signal<CrmComunicacion[]>([]);readonly clientes=signal<Cliente[]>([]);readonly usuarios=signal<AuthUser[]>([]);
 readonly segmento=this.fb.nonNullable.group({nombre:['',Validators.required],descripcion:'',tipoCliente:'',diasInactivo:[0,Validators.min(0)]});
 readonly plantilla=this.fb.nonNullable.group({nombre:['',Validators.required],canal:'WhatsApp',asunto:'',contenido:['',Validators.required]});
 readonly campana=this.fb.nonNullable.group({nombre:['',Validators.required],idSegmento:[0],idPlantilla:[0],fechaInicio:'',fechaFin:'',objetivo:''});
 readonly encuesta=this.fb.nonNullable.group({idCliente:[0,Validators.min(1)],calificacion:[5,[Validators.min(1),Validators.max(5)]],comentario:''});
 readonly meta=this.fb.nonNullable.group({idUser:[0,Validators.min(1)],fechaInicio:['',Validators.required],fechaFin:['',Validators.required],montoObjetivo:[0,Validators.min(0)],oportunidadesObjetivo:[0,Validators.min(0)]});
 readonly tarea=this.fb.nonNullable.group({titulo:['',Validators.required],descripcion:'',prioridad:'Media',fechaVencimiento:['',Validators.required],idResponsable:[0,Validators.min(1)],idCliente:[0,Validators.min(1)]});
 readonly comunicacion=this.fb.nonNullable.group({idCliente:[0,Validators.min(1)],canal:'Llamada',direccion:'Saliente',resumen:['',Validators.required],fecha:''});
 constructor(){this.load();forkJoin({c:this.clientsApi.getClientes(),profile:this.auth.getProfile(),users:this.auth.getUsers().pipe(catchError(()=>of([] as AuthUser[])))}).subscribe({next:x=>{this.clientes.set(x.c);this.usuarios.set(x.users.length?x.users:[x.profile]);this.tarea.patchValue({idResponsable:x.profile.idUser})},error:()=>this.notice.show('No se pudieron cargar clientes y responsables.')})}
 load(){forkJoin({s:this.api.segmentos(),p:this.api.plantillas(),c:this.api.campanas(),e:this.api.encuestas(),m:this.api.metas(),t:this.api.tareas()}).subscribe({next:x=>{this.segmentos.set(x.s);this.plantillas.set(x.p);this.campanas.set(x.c);this.encuestas.set(x.e);this.metas.set(x.m);this.tareas.set(x.t)},error:()=>this.notice.show('No se pudo cargar la operación CRM.')})}
 saveSegment(){if(this.segmento.invalid)return;const r=this.segmento.getRawValue();this.api.crearSegmento({...r,tipoCliente:r.tipoCliente||undefined,diasInactivo:r.diasInactivo||undefined}).subscribe({next:()=>{this.notice.show('Segmento creado.',3000,'info');this.segmento.reset({nombre:'',descripcion:'',tipoCliente:'',diasInactivo:0});this.load()},error:()=>this.notice.show('No se pudo crear el segmento.')})}
 saveTemplate(){if(this.plantilla.invalid)return;this.api.crearPlantilla(this.plantilla.getRawValue()).subscribe({next:()=>{this.notice.show('Plantilla guardada.',3000,'info');this.plantilla.reset({nombre:'',canal:'WhatsApp',asunto:'',contenido:''});this.load()},error:()=>this.notice.show('No se pudo guardar la plantilla.')})}
 saveCampaign(){if(this.campana.invalid)return;const r=this.campana.getRawValue();this.api.crearCampana({...r,idSegmento:r.idSegmento||undefined,idPlantilla:r.idPlantilla||undefined,fechaInicio:r.fechaInicio||undefined,fechaFin:r.fechaFin||undefined}).subscribe({next:()=>{this.notice.show('Campaña creada como borrador; no se enviaron mensajes.',4000,'info');this.load()},error:()=>this.notice.show('No se pudo crear la campaña.')})}
 saveSurvey(){if(this.encuesta.invalid)return;this.api.crearEncuesta(this.encuesta.getRawValue()).subscribe({next:()=>{this.notice.show('Encuesta registrada.',3000,'info');this.encuesta.reset({idCliente:0,calificacion:5,comentario:''});this.load()},error:()=>this.notice.show('No se pudo registrar la encuesta.')})}
 saveGoal(){if(this.meta.invalid)return;this.api.crearMeta(this.meta.getRawValue()).subscribe({next:()=>{this.notice.show('Meta comercial guardada.',3000,'info');this.load()},error:()=>this.notice.show('No se pudo guardar la meta.')})}
 saveTask(){if(this.tarea.invalid)return;this.api.crearTarea(this.tarea.getRawValue()).subscribe({next:()=>{this.notice.show('Tarea asignada.',3000,'info');const idResponsable=this.tarea.controls.idResponsable.value;this.tarea.reset({titulo:'',descripcion:'',prioridad:'Media',fechaVencimiento:'',idResponsable,idCliente:0});this.load()},error:()=>this.notice.show('No se pudo crear la tarea.')})}
 changeTask(task:CrmTarea,estado:CrmTaskStatus){this.api.actualizarTarea(task.idTarea,{estado,expectedVersion:task.version}).subscribe({next:()=>{this.notice.show('Tarea actualizada.',2500,'info');this.load()},error:()=>this.notice.show('La tarea cambió o no pudo actualizarse.')})}
 loadCommunications(){const idCliente=this.comunicacion.controls.idCliente.value;if(!idCliente){this.comunicaciones.set([]);return}this.api.comunicaciones({idCliente}).subscribe({next:rows=>this.comunicaciones.set(rows),error:()=>this.notice.show('No se pudo cargar la bitácora.')})}
 saveCommunication(){if(this.comunicacion.invalid)return;const value=this.comunicacion.getRawValue();this.api.crearComunicacion({...value,fecha:value.fecha||undefined}).subscribe({next:()=>{this.notice.show('Comunicación registrada; no se envió ningún mensaje.',3500,'info');this.comunicacion.patchValue({resumen:'',fecha:''});this.loadCommunications()},error:()=>this.notice.show('No se pudo registrar la comunicación.')})}
 isOverdue(task:CrmTarea){return !['Completada','Cancelada'].includes(task.estado)&&new Date(task.fechaVencimiento).getTime()<Date.now()}
 progress(m:CrmMeta){return Number(m.montoObjetivo)>0?Math.min(100,Math.round(Number(m.montoLogrado)/Number(m.montoObjetivo)*100)):0}
}
