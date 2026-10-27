import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting,HttpTestingController } from '@angular/common/http/testing';
import { PasswordRecoveryService } from './password-recovery.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';

describe('API recuperación local sin persistir secretos',()=>{
  let api:PasswordRecoveryService,http:HttpTestingController;const auth={clearSession:jasmine.createSpy('clearSession')};
  const url=environment.apiBaseUrl+'/auth/password-recovery';
  beforeEach(()=>{auth.clearSession.calls.reset();TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting(),{provide:AuthService,useValue:auth}]});api=TestBed.inject(PasswordRecoveryService);http=TestBed.inject(HttpTestingController);});
  afterEach(()=>http.verify());
  it('emite y confirma únicamente por cuerpo privado, sin usar almacenamiento',()=>{
    const local=spyOn(localStorage,'setItem'),session=spyOn(sessionStorage,'setItem');
    api.begin('fixture-password','').subscribe();const begin=http.expectOne(url+'/setup');expect(begin.request.body).toEqual({currentPassword:'fixture-password'});expect(begin.request.context.get(LOCAL_ERROR_FEEDBACK)).toBeTrue();begin.flush({recoveryKey:'public-fixture',expiresIn:600,validityDays:365});
    api.confirm('public-fixture').subscribe();const confirm=http.expectOne(url+'/confirm');expect(confirm.request.body).toEqual({recoveryKey:'public-fixture'});confirm.flush({message:'fixture'});
    expect(local).not.toHaveBeenCalled();expect(session).not.toHaveBeenCalled();
  });
  it('recuperar termina la identidad local y nunca realiza login automático',()=>{
    api.recover({username:'fixture',recoveryKey:'public-fixture',newPassword:'new-fixture-password',confirmation:'new-fixture-password'}).subscribe();
    expect(auth.clearSession).not.toHaveBeenCalled();http.expectOne(url+'/complete').flush({message:'fixture'});expect(auth.clearSession).toHaveBeenCalledTimes(1);
  });
  it('rechazo no borra identidad y permite al formulario mostrar el error local',()=>{
    let failed=false;api.recover({username:'fixture',recoveryKey:'public-fixture',newPassword:'new-fixture-password',confirmation:'new-fixture-password'}).subscribe({error:()=>failed=true});
    http.expectOne(url+'/complete').flush({message:'fixture'},{status:400,statusText:'Bad Request'});expect(failed).toBeTrue();expect(auth.clearSession).not.toHaveBeenCalled();
  });
});
