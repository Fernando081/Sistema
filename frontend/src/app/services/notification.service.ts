import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';

export interface AppNotification {idNotification:number;type:string;title:string;message:string;severity:'info'|'warning'|'critical';route?:string;readAt?:string;createdAt:string}
export interface NotificationResponse {unread:number;items:AppNotification[]}

@Injectable({providedIn:'root'})
export class NotificationService{
  private readonly http=inject(HttpClient);private readonly api=`${environment.apiBaseUrl}/notifications`;
  list(){return this.http.get<NotificationResponse>(this.api)}
  read(id:number){return this.http.post(`${this.api}/${id}/read`,{})}
  readAll(){return this.http.post(`${this.api}/read-all`,{})}
}
