import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { LOCAL_ERROR_FEEDBACK } from '../shared/http-error-context';
import { AuthService } from './auth.service';

export interface RecoveryStatus {configured:boolean;confirmedAt:string|null;expiresAt:string|null;pending:boolean}
export interface RecoverPasswordInput {username:string;recoveryKey:string;newPassword:string;confirmation:string;code?:string}
@Injectable({providedIn:'root'})
export class PasswordRecoveryService {
  private readonly http=inject(HttpClient);private readonly auth=inject(AuthService);
  private readonly url=environment.apiBaseUrl+'/auth/password-recovery';
  private local(){return {context:new HttpContext().set(LOCAL_ERROR_FEEDBACK,true)};}
  status(){return this.http.get<RecoveryStatus>(this.url+'/status');}
  begin(currentPassword:string,code:string){return this.http.post<{recoveryKey:string;expiresIn:number;validityDays:number}>(this.url+'/setup',{currentPassword,...(code?{code}:{})},this.local());}
  confirm(recoveryKey:string){return this.http.post<{message:string}>(this.url+'/confirm',{recoveryKey},this.local());}
  revoke(currentPassword:string,code:string){return this.http.post<{message:string}>(this.url+'/revoke',{currentPassword,...(code?{code}:{})},this.local());}
  recover(input:RecoverPasswordInput){return this.http.post<{message:string}>(this.url+'/complete',input,this.local()).pipe(tap(()=>this.auth.clearSession()));}
}
