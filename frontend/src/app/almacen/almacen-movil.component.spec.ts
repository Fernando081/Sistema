import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AlmacenMovilComponent } from './almacen-movil.component';
import { AlmacenMovilService, MobilePick } from './almacen-movil.service';
import { ConfirmService } from '../shared/confirm.service';

describe('Escaneo: revisión física sincronizada con los códigos',()=>{
 it('desmarca la revisión al cambiar códigos y exige revisarla otra vez sin registrar automáticamente',async()=>{
  const verify=jasmine.createSpy('verify');
  await TestBed.configureTestingModule({imports:[AlmacenMovilComponent],providers:[provideRouter([]),
   {provide:AlmacenMovilService,useValue:{list:()=>of({data:[],total:0}),verify}},
   {provide:ConfirmService,useValue:{ask:()=>of(false)}},
  ]}).compileComponents();
  const fixture=TestBed.createComponent(AlmacenMovilComponent),c=fixture.componentInstance;
  const p:MobilePick={id:'1',idProducto:2,idUbicacion:3,codigo:'FILTRO',producto:'Filtro',almacen:'TAM-01',ubicacion:'GENERAL',cantidad:'2.000000',verificada:'0',pendiente:'2.000000',estado:'Reservada',habilitada:true,revision:0,evaluacionSha256:'a'.repeat(64)};
  c.detail.set({pedido:{id:1,folio:'1',estado:'Surtido',version:1},data:[p],total:1,page:1,idUsuario:1,administrador:true});c.choose(p);fixture.detectChanges();await fixture.whenStable();
  const root:HTMLElement=fixture.nativeElement as HTMLElement;
  const input=async(id:string,value:string)=>{const node=root.querySelector<HTMLInputElement>('#'+id)!;node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));fixture.detectChanges();await fixture.whenStable();fixture.detectChanges();};
  await input('scan-location','GENERAL');await input('scan-product','FILTRO');
  const check=root.querySelector<HTMLInputElement>('input[type="checkbox"]')!,button=[...root.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()==='Confirmar recogida')!;
  check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}));fixture.detectChanges();expect(button.disabled).toBeTrue();
  await input('scan-location','TAM-01/GENERAL');
  root.querySelector('#scan-location')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  expect(check.checked).toBeFalse();expect(button.disabled).toBeTrue();
  check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}));fixture.detectChanges();expect(button.disabled).toBeFalse();
  await input('scan-location','OTRO/GENERAL');expect(check.checked).toBeFalse();expect(button.disabled).toBeTrue();
  await input('scan-location','RTT1:U:3');expect(button.disabled).toBeTrue();check.checked=true;check.dispatchEvent(new Event('change',{bubbles:true}));fixture.detectChanges();expect(button.disabled).toBeFalse();
  expect(verify).not.toHaveBeenCalled();fixture.destroy();
 });
});
