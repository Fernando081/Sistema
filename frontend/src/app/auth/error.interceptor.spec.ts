import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { errorInterceptor } from './error.interceptor';
import { AuthService } from './auth.service';
import { NotificationService } from '../shared/notification.service';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
import { environment } from '../../environments/environment';

describe('Errores locales y caducidad de sesión', () => {
  let http: HttpClient;
  let requests: HttpTestingController;
  const url = environment.apiBaseUrl + '/crm/solicitudes-web/fixture/estado';
  let show: jasmine.Spy;
  let clearSession: jasmine.Spy;
  let navigate: jasmine.Spy;
  beforeEach(() => {
    show = jasmine.createSpy('show');
    clearSession = jasmine.createSpy('clearSession');
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([errorInterceptor])), provideHttpClientTesting(),
      { provide: NotificationService, useValue: { show } },
      { provide: AuthService, useValue: { clearSession } },
      { provide: Router, useValue: { url: '/crm', navigate } },
    ] });
    http = TestBed.inject(HttpClient); requests = TestBed.inject(HttpTestingController);
  });
  afterEach(() => requests.verify());
  it('un401 del portal no borra ni redirige la sesión del ERP',()=>{
    let status=0;http.get(environment.apiBaseUrl+'/portal/sesion').subscribe({error:(e:HttpErrorResponse)=>status=e.status});
    requests.expectOne(environment.apiBaseUrl+'/portal/sesion').flush({message:'Sesión portal requerida'},{status:401,statusText:'Unauthorized'});
    expect(status).toBe(401);expect(clearSession).not.toHaveBeenCalled();expect(navigate).not.toHaveBeenCalled();expect(show).not.toHaveBeenCalled();
  });
  it('mantiene avisos por defecto y propaga error cuando la pantalla lo presenta localmente', () => {
    http.get(url).subscribe({ error: () => {} });
    requests.expectOne(url).flush({ message: 'Fallo fixture' }, { status: 503, statusText: 'Unavailable' });
    expect(show).toHaveBeenCalledWith('Fallo fixture', 4500);
    show.calls.reset();
    let status = 0;
    http.get(url, { context: new HttpContext().set(LOCAL_ERROR_FEEDBACK, true) })
      .subscribe({ error: (error: HttpErrorResponse) => { status = error.status; } });
    requests.expectOne(url).flush({}, { status: 404, statusText: 'Not found' });
    expect(status).toBe(404);
    expect(show).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
  });
  it('fallo de red local llega a la pantalla sin aviso duplicado', () => {
    let status = -1;
    http.get(url, { context: new HttpContext().set(LOCAL_ERROR_FEEDBACK, true) })
      .subscribe({ error: (error: HttpErrorResponse) => { status = error.status; } });
    requests.expectOne(url).error(new ProgressEvent('error'));
    expect(status).toBe(0);
    expect(show).not.toHaveBeenCalled();
  });
  it('401 siempre expira sesión y solicita login aunque se haya elegido feedback local', () => {
    http.get(url, { context: new HttpContext().set(LOCAL_ERROR_FEEDBACK, true) })
      .subscribe({ error: () => {} });
    requests.expectOne(url).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/crm' } });
    expect(show).toHaveBeenCalledWith('Tu sesión expiró. Inicia sesión nuevamente.', 4000);
  });
});
