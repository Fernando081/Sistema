// frontend/src/app/services/auditoria.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

import { AuditRecord } from '../reportes/auditoria/audit-diff';

export interface AuditLog {
  id: number;
  table_name: string;
  action: string;
  old_record: AuditRecord | null;
  new_record: AuditRecord | null;
  db_user: string;
  app_user_id?: number | null;
  app_username?: string | null;
  actor_name?:string|null;
  protection_version?:number;
  credential_changed?:boolean|null;
  timestamp: string;
}

export interface AuditProtection {appendOnly:boolean;actorSnapshots:boolean;accessTables:number;expectedAccessTables:number;privilegedDatabaseRole:boolean;newEventVersion:number;legacyLimit:number}

@Injectable({
  providedIn: 'root'
})
export class AuditoriaService {
  private apiUrl = `${environment.apiBaseUrl}/auditoria`;

  constructor(private http: HttpClient) {}

  getAuditLogs(): Observable<AuditLog[]> {
    return this.http.get<AuditLog[]>(this.apiUrl);
  }
  getProtection(){return this.http.get<AuditProtection>(this.apiUrl+'/estado');}
}
