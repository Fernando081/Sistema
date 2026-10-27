import { Component, OnInit, AfterViewInit, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { finalize, forkJoin } from 'rxjs';
import { AuditoriaService, AuditLog, AuditProtection } from '../../services/auditoria.service';

import { auditDiff, AuditRecord, AuditChange } from './audit-diff';

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
    MatPaginatorModule,
    MatButtonModule,
  ],
  templateUrl: './auditoria.html',
  styleUrls: ['./auditoria.css']
})
export class Auditoria implements OnInit, AfterViewInit {
  displayedColumns: string[] = ['timestamp', 'app_user', 'action', 'table_name', 'cambios'];
  dataSource = new MatTableDataSource<AuditLog>([]);
  isLoading = signal(true);
  readonly error=signal(false);
  readonly protection=signal<AuditProtection|null>(null);

  @ViewChild(MatPaginator) paginator!: MatPaginator;

  constructor(private auditoriaService: AuditoriaService) {}

  ngOnInit(): void {this.load();}
  load():void{
    this.isLoading.set(true);this.error.set(false);
    forkJoin({logs:this.auditoriaService.getAuditLogs(),protection:this.auditoriaService.getProtection()})
      .pipe(finalize(()=>this.isLoading.set(false))).subscribe({next:value=>{this.dataSource.data=value.logs;this.protection.set(value.protection);this.paginator?.firstPage();},
        error:()=>{this.error.set(true);this.dataSource.data=[];this.protection.set(null);}});
  }

  ngAfterViewInit() {
    this.dataSource.paginator = this.paginator;
  }

  getDiff(oldRec: AuditRecord | null, newRec: AuditRecord | null, action: string): AuditChange[] {
    return auditDiff(oldRec, newRec, action);
  }
}
