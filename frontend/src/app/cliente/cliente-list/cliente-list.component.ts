// frontend/src/app/cliente/cliente-list/cliente-list.component.ts

import { Component, OnInit, ViewChild, inject } from '@angular/core';
import anime from 'animejs';
import { CommonModule } from '@angular/common';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { MatPaginator, MatPaginatorModule } from '@angular/material/paginator';
import { MatSort, MatSortModule } from '@angular/material/sort';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ClienteService } from '../../services/cliente.service';
import { Cliente } from '../cliente.interface';
import { ClienteDialogComponent } from '../cliente-dialog/cliente-dialog.component';
import { finalize } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfirmService } from '../../shared/confirm.service';
import { ClienteUnidadesDialogComponent } from '../cliente-unidades-dialog/cliente-unidades-dialog.component';

@Component({
  selector: 'app-cliente-list',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatDialogModule, MatSnackBarModule, MatTooltipModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './cliente-list.component.html',
  styleUrls: ['./cliente-list.component.css']
})
export class ClienteListComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private routeFilter = '';
  
  // ¡CAMBIO! Volvemos a usar camelCase (minúsculas)
  displayedColumns: string[] = ['idCliente', 'rfc', 'razonSocial', 'codigoPostal', 'saldoAFavor', 'acciones'];
  dataSource = new MatTableDataSource<Cliente>();
  isLoading = true;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private clienteService: ClienteService,
    public dialog: MatDialog,
    private snackBar: MatSnackBar,
    private confirm: ConfirmService,
  ) {}

  ngOnInit(): void {
    this.routeFilter = (this.route.snapshot.queryParamMap.get('q') || '').trim().toLowerCase();
    this.cargarClientes();
  }

  cargarClientes(): void {
    this.isLoading = true;
    this.clienteService.getClientes()
      .pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: (data) => {
          this.dataSource.data = data;
          if (this.routeFilter) {
            this.dataSource.filterPredicate = (item, filter) => item.razonSocial.toLowerCase().includes(filter) || item.rfc.toLowerCase().includes(filter);
            this.dataSource.filter = this.routeFilter;
          }
          this.dataSource.paginator = this.paginator;
          this.dataSource.sort = this.sort;
          setTimeout(() => this.animarEntradaTabla(), 0);
        },
        error: (err) => {
          this.mostrarNotificacion('Error al cargar clientes: ' + (err.error?.message || err.message));
        }
      });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
    
    this.dataSource.filterPredicate = (data: Cliente, filter: string) => {
      return data.razonSocial.toLowerCase().includes(filter) || 
             data.rfc.toLowerCase().includes(filter);
    };

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
  }

  abrirDialogo(cliente?: Cliente): void {
    const dialogRef = this.dialog.open(ClienteDialogComponent, {
      width: '600px',
      data: cliente ? {...cliente} : null 
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.cargarClientes();
      }
    });
  }

  administrarUnidades(cliente: Cliente): void {
    this.dialog.open(ClienteUnidadesDialogComponent, {
      width: '920px',
      maxWidth: '96vw',
      data: { idCliente: cliente.idCliente, razonSocial: cliente.razonSocial },
      disableClose: true,
    });
  }

  verCliente360(cliente: Cliente): void {
    void this.router.navigate(['/cliente', cliente.idCliente]);
  }

  eliminarCliente(idCliente: number): void {
    this.confirm.ask({ title: 'Eliminar cliente', message: 'Se eliminará la ficha del cliente si no tiene operaciones que deban conservarse.', confirmLabel: 'Eliminar cliente' }).subscribe(confirmed => {
      if (!confirmed) return;
      this.clienteService.deleteCliente(idCliente).subscribe({
        next: () => {
          this.mostrarNotificacion('Cliente eliminado con éxito');
          this.cargarClientes();
        },
        error: (err) => {
          this.mostrarNotificacion('Error al eliminar cliente: ' + (err.error?.message || err.message));
        }
      });
    });
  }

  mostrarNotificacion(mensaje: string) {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 });
  }

  animarEntradaTabla() {
    anime({ targets: '.mat-mdc-row', translateY: [20, 0], opacity: [0, 1], delay: anime.stagger(50), duration: 400, easing: 'easeOutCubic' });
  }
}
