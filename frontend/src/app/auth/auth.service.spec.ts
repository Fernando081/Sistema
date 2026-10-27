import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

describe('Identidad de navegador sin JWT en Web Storage',()=>{
  let service:AuthService,http:HttpTestingController;
  const state=()=>({profile:{idUser:1,username:'José García',role:'admin',isActive:true},expiresAt:Math.floor(Date.now()/1000)+3600});
  beforeEach(()=>{
    localStorage.clear();sessionStorage.clear();
    TestBed.configureTestingModule({providers:[AuthService,provideHttpClient(),provideHttpClientTesting()]});
    service=TestBed.inject(AuthService);http=TestBed.inject(HttpTestingController);
  });
  afterEach(()=>{http.verify();localStorage.clear();sessionStorage.clear();});
  it('purga credenciales anteriores y conserva preferencias ajenas',()=>{
    localStorage.setItem('access_token','legacy');sessionStorage.setItem('access_token','legacy');localStorage.setItem('theme','dark');
    service.clearSession();expect(localStorage.getItem('access_token')).toBeNull();expect(sessionStorage.getItem('access_token')).toBeNull();expect(localStorage.getItem('theme')).toBe('dark');
  });
  it('conserva solo identidad pública en memoria al iniciar sesión',()=>{
    service.login({username:'fixture',password:'fixture-password'}).subscribe();
    http.expectOne(environment.apiBaseUrl+'/auth/login').flush(state());
    expect(service.getSessionIdentity()).toEqual(jasmine.objectContaining({sub:'José García',role:'admin',idUser:1}));
    expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
  });
  it('rechaza una respuesta Bearer y no almacena el JWT',()=>{
    let failed=false;service.login({username:'fixture',password:'fixture-password'}).subscribe({error:()=>failed=true});
    http.expectOne(environment.apiBaseUrl+'/auth/login').flush({access_token:'not-saved'});
    expect(failed).toBeTrue();expect(service.isAuthenticated()).toBeFalse();expect(localStorage.length).toBe(0);
  });
  it('restaura una sola vez para guards simultáneos y reutiliza metadata vigente',()=>{
    const results:boolean[]=[];service.ensureSession().subscribe(value=>results.push(value));service.ensureSession().subscribe(value=>results.push(value));
    http.expectOne(environment.apiBaseUrl+'/auth/browser-state').flush(state());
    service.ensureSession().subscribe(value=>results.push(value));expect(results).toEqual([true,true,true]);
  });
  it('no resucita identidad después de cerrar acceso con restauración pendiente',()=>{
    let restored=true;service.ensureSession().subscribe(value=>restored=value);service.clearSession();
    http.expectOne(environment.apiBaseUrl+'/auth/browser-state').flush(state());
    expect(restored).toBeFalse();expect(service.getSessionIdentity()).toBeNull();
  });
  it('401 de restauración deja el guard sin sesión y permite un nuevo intento',()=>{
    let restored=true;service.ensureSession().subscribe(value=>restored=value);
    http.expectOne(environment.apiBaseUrl+'/auth/browser-state').flush({}, {status:401,statusText:'Unauthorized'});
    expect(restored).toBeFalse();service.ensureSession().subscribe();http.expectOne(environment.apiBaseUrl+'/auth/browser-state').flush(state());
    expect(service.isAuthenticated()).toBeTrue();
  });
  it('ignora metadata vencida y estados sin usuario registrado',()=>{
    for(const changes of [{expiresAt:1},{profile:{...state().profile,idUser:0}}]){
      let restored=true;service.ensureSession().subscribe(value=>restored=value);
      http.expectOne(environment.apiBaseUrl+'/auth/browser-state').flush({...state(),...changes});expect(restored).toBeFalse();
    }
  });
  it('logout borra identidad y solicita revocación al servidor',()=>{
    service.login({username:'fixture',password:'fixture-password'}).subscribe();http.expectOne(environment.apiBaseUrl+'/auth/login').flush(state());
    service.logout();expect(service.getSessionIdentity()).toBeNull();http.expectOne(environment.apiBaseUrl+'/auth/logout').flush({message:'Sesión cerrada'});
  });
  it('reto MFA no autentica ni persiste y segundo factor restaura identidad pública',()=>{
    service.login({username:'fixture',password:'fixture-password'}).subscribe();
    http.expectOne(environment.apiBaseUrl+'/auth/login').flush({mfaRequired:true,challenge:'opaque',expiresIn:300});
    expect(service.isAuthenticated()).toBeFalse();expect(sessionStorage.length).toBe(0);expect(localStorage.length).toBe(0);
    service.completeMfa('opaque','123456').subscribe();
    const request=http.expectOne(environment.apiBaseUrl+'/auth/mfa/login');expect(request.request.body).toEqual({challenge:'opaque',code:'123456'});request.flush(state());
    expect(service.isAuthenticated()).toBeTrue();expect(sessionStorage.length).toBe(0);expect(localStorage.length).toBe(0);
  });
  it('segundo factor pendiente no revive identidad cancelada',()=>{
    let failed=false;service.completeMfa('opaque','123456').subscribe({error:()=>failed=true});service.clearSession();
    http.expectOne(environment.apiBaseUrl+'/auth/mfa/login').flush(state());expect(failed).toBeTrue();expect(service.isAuthenticated()).toBeFalse();
  });
});
