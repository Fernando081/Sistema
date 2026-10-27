import { TestBed } from '@angular/core/testing';
import { HttpClient,provideHttpClient,withInterceptors } from '@angular/common/http';
import { HttpTestingController,provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { environment } from '../../environments/environment';

describe('Transporte limitado a la API ERP',()=>{
  let http:HttpClient,requests:HttpTestingController;
  beforeEach(()=>{TestBed.configureTestingModule({providers:[provideHttpClient(withInterceptors([authInterceptor])),provideHttpClientTesting()]});
    http=TestBed.inject(HttpClient);requests=TestBed.inject(HttpTestingController);});
  afterEach(()=>requests.verify());
  it('marca portal con cabecera propia y mantiene separados ambos transportes',()=>{
    http.post(environment.apiBaseUrl+'/portal/login',{}).subscribe();const r=requests.expectOne(environment.apiBaseUrl+'/portal/login');
    expect(r.request.withCredentials).toBeTrue();expect(r.request.headers.get('X-Portal-Browser')).toBe('1');expect(r.request.headers.has('X-ERP-Browser')).toBeFalse();expect(r.request.headers.has('Authorization')).toBeFalse();r.flush({});
  });
  it('marca API para cookie y defensa CSRF sin construir Authorization',()=>{
    http.post(environment.apiBaseUrl+'/fixture',{}).subscribe();const request=requests.expectOne(environment.apiBaseUrl+'/fixture');
    expect(request.request.withCredentials).toBeTrue();expect(request.request.headers.get('X-ERP-Browser')).toBe('1');expect(request.request.headers.has('Authorization')).toBeFalse();request.flush({});
  });
  it('no añade credenciales ni cabeceras a otros orígenes o prefijos parecidos',()=>{
    for(const url of ['https://outside.example.test/api/v1/fixture','/api/v10/fixture','/assets/logo.svg']){
      http.get(url).subscribe();const request=requests.expectOne(url);expect(request.request.withCredentials).toBeFalse();expect(request.request.headers.has('X-ERP-Browser')).toBeFalse();request.flush({});
    }
  });
});
