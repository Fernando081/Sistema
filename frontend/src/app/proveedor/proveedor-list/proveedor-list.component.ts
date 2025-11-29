// frontend/src/app/proveedor/proveedor-list/proveedor-list.component.ts (REEMPLAZAR)

import { Component, OnInit, ViewChild } from '@angular/core';
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
import { ProveedorService } from '../../services/proveedor.service'; // CAMBIO
import { Proveedor } from '../proveedor.interface'; // CAMBIO
import { ProveedorDialogComponent } from '../proveedor-dialog/proveedor-dialog.component'; // CAMBIO
import { finalize } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-proveedor-list', // CAMBIO
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatDialogModule, MatSnackBarModule, MatTooltipModule,
    MatProgressSpinnerModule, ProveedorDialogComponent // CAMBIO
  ],
  templateUrl: './proveedor-list.component.html',
  styleUrls: ['./proveedor-list.component.css']
})
export class ProveedorListComponent implements OnInit {
  
  displayedColumns: string[] = ['idProveedor', 'rfc', 'razonSocial', 'codigoPostal', 'acciones']; // CAMBIO
  dataSource = new MatTableDataSource<Proveedor>(); // CAMBIO
  isLoading = true;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private proveedorService: ProveedorService, // CAMBIO
    public dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.cargarProveedores(); // CAMBIO
  }

  cargarProveedores(): void { // CAMBIO
    this.isLoading = true;
    this.proveedorService.getProveedores() // CAMBIO
      .pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: (data) => {
          // Mapeamos de PascalCase (DB) a camelCase (Angular)
          const camelCaseData: Proveedor[] = data.map(prov => ({
            idProveedor: prov['IdProveedor'],
            rfc: prov['RFC'],
            razonSocial: prov['RazonSocial'],
            pais: prov['Pais'],
            idEstado: prov['IdEstado'],
            idMunicipio: prov['IdMunicipio'],
            ciudad: prov['Ciudad'],
            colonia: prov['Colonia'],
            calle: prov['Calle'],
            codigoPostal: prov['CodigoPostal'],
            numeroExterior: prov['NumeroExterior'],
            numeroInterior: prov['NumeroInterior'],
            referencia: prov['Referencia'],
            idMetodoDePago: prov['IdMetodoDePago'],
            idUsoCFDI: prov['IdUsoCFDI'],
            idFormaPago: prov['IdFormaPago'],
            idRegimenFiscal: prov['IdRegimenFiscal']
          }));
          this.dataSource.data = camelCaseData;
          this.dataSource.paginator = this.paginator;
          this.dataSource.sort = this.sort;
        },
        error: (err) => {
          this.mostrarNotificacion('Error al cargar proveedores: ' + (err.error?.message || err.message));
        }
      });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
    
    this.dataSource.filterPredicate = (data: Proveedor, filter: string) => { // CAMBIO
      return data.razonSocial.toLowerCase().includes(filter) || 
             data.rfc.toLowerCase().includes(filter);
    };

    if (this.dataSource.paginator) {
      this.dataSource.paginator.firstPage();
    }
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
    if (confirm('¿Estás seguro de que deseas eliminar este proveedor?')) {
      this.proveedorService.deleteProveedor(idProveedor).subscribe({ // CAMBIO
        next: () => {
          this.mostrarNotificacion('Proveedor eliminado con éxito'); // CAMBIO
          this.cargarProveedores(); // CAMBIO
        },
        error: (err) => {
          this.mostrarNotificacion('Error al eliminar proveedor: ' + (err.error?.message || err.message));
        }
      });
    }
  }

  mostrarNotificacion(mensaje: string) {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 });
  }
}