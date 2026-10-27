import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Subject, of, throwError } from 'rxjs';
import { PedidoService } from '../services/pedido.service';
import { EntregaDialogComponent } from './entrega-dialog.component';
describe('Entrega y evidencias',()=>{
 const state={estado:'Surtido',version:3,evidencia:null,entregaAnterior:null};
 function setup(service:Partial<PedidoService>){
  const ref={close:jasmine.createSpy(),disableClose:false};
  TestBed.configureTestingModule({providers:[{provide:PedidoService,useValue:{delivery:()=>of(state),...service}},{provide:MAT_DIALOG_DATA,useValue:4},{provide:MatDialogRef,useValue:ref}]});
  return{component:TestBed.runInInjectionContext(()=>new EntregaDialogComponent()),ref};
 }
 it('exige evidencia o motivo y confirmación antes de enviar',async()=>{
  const save=jasmine.createSpy();const{component:c}=setup({evidenceDelivery:save});
  c.recibidoPor='Receptor';await c.submit();expect(save).not.toHaveBeenCalled();c.confirmacion=true;await c.submit();expect(c.error()).toContain('explica');expect(save).not.toHaveBeenCalled();
 });
 it('conserva UUID al reintentar mismos datos y lo renueva al corregir contenido',async()=>{
  const bodies:FormData[]=[];const{component:c}=setup({evidenceDelivery:(_id,body)=>{bodies.push(body);return throwError(()=>new HttpErrorResponse({status:0}));}});
  c.recibidoPor='Receptor';c.confirmacion=true;c.motivo='No quiso firmar';await c.submit();await c.submit();
  expect(bodies[0].get('requestId')).toBe(bodies[1].get('requestId'));c.notas='Otra nota';await c.submit();expect(bodies[2].get('requestId')).not.toBe(bodies[0].get('requestId'));expect(c.busy()).toBeFalse();
 });
 it('mantiene bloqueo durante registro y recarga; no cierra antes de finalizar',async()=>{
  const action=new Subject<object>(),reload=new Subject<typeof state>();let calls=0;
  const{component:c,ref}=setup({delivery:()=>++calls===1?of(state):reload,evidenceDelivery:()=>action});c.recibidoPor='Receptor';c.confirmacion=true;c.motivo='Sólo mostrador';
  await c.submit();expect(ref.disableClose).toBeTrue();c.close();expect(ref.close).not.toHaveBeenCalled();action.next({});action.complete();expect(c.busy()).toBeTrue();reload.next(state);reload.complete();expect(c.busy()).toBeFalse();c.close();expect(ref.close).toHaveBeenCalledWith(true);
 });
 it('rechaza tipo/tamaño y conserva archivo previo válido',()=>{
  const{component:c}=setup({});const input=document.createElement('input');c.foto=new File(['ok'],'ok.png',{type:'image/png'});
  Object.defineProperty(input,'files',{value:[new File(['svg'],'bad.svg',{type:'image/svg+xml'})]});c.select({target:input}as unknown as Event,'foto');expect(c.error()).toContain('Foto');expect(c.foto?.name).toBe('ok.png');
 });
 it('ignora una ubicación tardía después de quitarla',()=>{
  const{component:c}=setup({});let success:PositionCallback|undefined;
  spyOn(navigator.geolocation,'getCurrentPosition').and.callFake(callback=>{success=callback;});c.locate();c.removeLocation();
  success!({coords:{latitude:22,longitude:-97,accuracy:10},timestamp:Date.now()}as GeolocationPosition);expect(c.ubicacion).toBeNull();expect(c.locating()).toBeFalse();
 });
});
