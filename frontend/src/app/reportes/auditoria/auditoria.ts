import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuditoriaService, AuditLog } from '../../services/auditoria.service';

@Component({
  selector: 'app-auditoria',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  templateUrl: './auditoria.html',
  styleUrls: ['./auditoria.css']
})
export class Auditoria implements OnInit {
  displayedColumns: string[] = ['timestamp', 'db_user', 'action', 'table_name', 'cambios'];
  logs = signal<AuditLog[]>([]);
  isLoading = signal(true);

  constructor(private auditoriaService: AuditoriaService) {}

  ngOnInit(): void {
    this.auditoriaService.getAuditLogs().subscribe({
      next: (data) => {
        this.logs.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      }
    });
  }

  getDiff(oldRec: any, newRec: any, action: string): { field: string, old: string, new: string }[] {
    const diff: { field: string, old: string, new: string }[] = [];
    if (action === 'INSERT' && newRec) {
       diff.push({ field: '(Nuevo Registro)', old: '-', new: JSON.stringify(newRec) });
    } else if (action === 'DELETE' && oldRec) {
       diff.push({ field: '(Registro Borrado)', old: JSON.stringify(oldRec), new: '-' });
    } else if (action === 'UPDATE' && oldRec && newRec) {
       for (const key in newRec) {
         if (oldRec[key] !== newRec[key]) {
           diff.push({ field: key, old: oldRec[key] !== null ? String(oldRec[key]) : 'null', new: newRec[key] !== null ? String(newRec[key]) : 'null' });
         }
       }
    }
    return diff;
  }
}
