import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of,throwError } from 'rxjs';
import { PortalClienteComponent } from './portal-cliente.component';
import { PortalDocument,PortalService } from './portal.service';
describe('Estado privado del portal',()=>{
 const profile={nombre:'Contacto de prueba',alias:'portal-prueba',cliente:'Cliente de prueba',venceEn:new Date(Date.now()+3600000).toISOString()};
 const denied=()=>throwError(()=>new HttpErrorResponse({status:401}));
 function setup(service:Partial<PortalService>,path='portal'){
  TestBed.configureTestingModule({providers:[{provide:PortalService,useValue:{state:denied,...service}},{provide:ActivatedRoute,useValue:{snapshot:{routeConfig:{path}}}}]});return TestBed.runInInjectionContext(()=>new PortalClienteComponent());
 }
 it('una visita sin sesión muestra login sin presentar401 como fallo',()=>{const c=setup({});expect(c.profile()).toBeNull();expect(c.error()).toBe('');expect(c.busy()).toBeFalse();});
 it('login restaura identidad y consulta sólo la sección del portal',()=>{
  const login=jasmine.createSpy().and.returnValue(of({})),list=jasmine.createSpy().and.returnValue(of({data:[],total:0,page:1,limit:20}));const c=setup({state:jasmine.createSpy().and.returnValues(denied(),of(profile)),login,list});
  c.alias='portal-prueba';c.password='contraseña sólo para prueba';c.login();expect(login).toHaveBeenCalledWith(c.alias,'contraseña sólo para prueba');expect(c.password).toBe('');expect(c.profile()).toEqual(profile);expect(list).toHaveBeenCalledWith('pedidos',1,'');expect(c.busy()).toBeFalse();
 });
 it('caducidad elimina datos y detalle del cliente del estado en memoria',()=>{
  const c=setup({list:denied});c.profile.set(profile);c.selected.set({id:1}as PortalDocument);c.rows.set([{id:1}as PortalDocument]);c.load();expect(c.profile()).toBeNull();expect(c.selected()).toBeNull();expect(c.rows()).toEqual([]);
 });
 it('no deja resultados anteriores visibles después de una consulta fallida',()=>{
  const c=setup({list:()=>throwError(()=>new HttpErrorResponse({status:503}))});c.profile.set(profile);c.rows.set([{id:1}as PortalDocument]);c.total=25;c.load();expect(c.rows()).toEqual([]);expect(c.total).toBe(0);expect(c.profile()).toEqual(profile);expect(c.error()).not.toBe('');
 });
 it('una salida fallida no afirma que la sesión haya sido revocada',()=>{const c=setup({logout:()=>throwError(()=>new HttpErrorResponse({status:0}))});c.profile.set(profile);c.logout();expect(c.profile()).toEqual(profile);expect(c.notice()).toBe('');});
 it('no activa si la confirmación de contraseña es diferente',()=>{const activate=jasmine.createSpy();const c=setup({activate},'portal/activar');c.password='Una clave suficientemente larga';c.repeat='otra';c.activate();expect(activate).not.toHaveBeenCalled();});
});
