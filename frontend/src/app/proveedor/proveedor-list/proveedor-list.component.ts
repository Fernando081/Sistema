// frontend/src/app/proveedor/proveedor-list/proveedor-list.component.ts (REEMPLAZAR)

import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProveedorService } from '../../services/proveedor.service'; // CAMBIO
import { Proveedor } from '../proveedor.interface'; // CAMBIO
import { ProveedorDialogComponent } from '../proveedor-dialog/proveedor-dialog.component'; // CAMBIO
import { RemoteDirectory } from '../../shared/remote-directory';
import { localDate } from '../../shared/document-download';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ConfirmService } from '../../shared/confirm.service';

import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-proveedor-list', // CAMBIO
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatDialogModule, MatSnackBarModule, MatTooltipModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './proveedor-list.component.html',
  styleUrls: ['../../shared/list-page.css', './proveedor-list.component.css']
})
export class ProveedorListComponent implements OnInit, OnDestroy {
  
  displayedColumns: string[] = ['idProveedor', 'rfc', 'razonSocial', 'codigoPostal', 'acciones']; // CAMBIO
  readonly directory: RemoteDirectory<Proveedor>;
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  get dataSource() { return this.directory.dataSource; }
  get isLoading() { return this.directory.loading(); }
  get totalItems() { return this.directory.total(); }

  constructor(
    private proveedorService: ProveedorService, // CAMBIO
    public dialog: MatDialog,
    private snackBar: MatSnackBar,
    private confirm: ConfirmService,
  ) {
    this.directory = new RemoteDirectory(query => this.proveedorService.getPage(query), message => this.mostrarNotificacion(message));
  }

  ngOnInit(): void {
    this.directory.connectUrl(this.route, this.router);
    this.directory.start();
  }
  ngOnDestroy(): void { this.directory.dispose(); }
  cargarProveedores(): void { this.directory.reload(); }
  applyFilter(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) this.directory.setTerm(input.value);
  }
  exportar(): void {
    this.directory.export(query => this.proveedorService.exportCsv(query), 'proveedores' + '_' + localDate() + '.csv');
  }
  abrirDialogo(proveedor?: Proveedor): void { // CAMBIO
    const dialogRef = this.dialog.open(ProveedorDialogComponent, { // CAMBIO
      width: '600px',
      data: proveedor ? {...proveedor} : null 
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.cargarProveedores(); // CAMBIO
      }
    });
  }

  eliminarProveedor(idProveedor: number): void { // CAMBIO
    this.confirm.ask({ title: 'Eliminar proveedor', message: 'Se eliminará el proveedor si no existen compras o saldos que deban conservarse.', confirmLabel: 'Eliminar proveedor' }).subscribe(confirmed => {
      if (!confirmed) return;
      this.proveedorService.deleteProveedor(idProveedor).subscribe({ // CAMBIO
        next: () => {
          this.mostrarNotificacion('Proveedor eliminado con éxito'); // CAMBIO
          this.cargarProveedores(); // CAMBIO
        },
        error: (err) => {
          this.mostrarNotificacion('Error al eliminar proveedor: ' + (err.error?.message || err.message));
        }
      });
    });
  }

  mostrarNotificacion(mensaje: string) {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 });
  }
}
