// frontend/src/app/cliente/cliente-list/cliente-list.component.ts

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
import { ClienteService } from '../../services/cliente.service';
import { Cliente } from '../cliente.interface';
import { ClienteDialogComponent } from '../cliente-dialog/cliente-dialog.component';
import { finalize } from 'rxjs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-cliente-list',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatDialogModule, MatSnackBarModule, MatTooltipModule,
    MatProgressSpinnerModule, ClienteDialogComponent
  ],
  templateUrl: './cliente-list.component.html',
  styleUrls: ['./cliente-list.component.css']
})
export class ClienteListComponent implements OnInit {
  
  // ¡CAMBIO! Volvemos a usar camelCase (minúsculas)
  displayedColumns: string[] = ['idCliente', 'rfc', 'razonSocial', 'codigoPostal', 'acciones'];
  dataSource = new MatTableDataSource<Cliente>();
  isLoading = true;

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private clienteService: ClienteService,
    public dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.cargarClientes();
  }

  cargarClientes(): void {
    this.isLoading = true;
    this.clienteService.getClientes()
      .pipe(finalize(() => this.isLoading = false))
      .subscribe({
        next: (data) => {
          // ¡CAMBIO! Mapeamos la data de PascalCase a camelCase
          // Esto soluciona el problema de la tabla vacía
          const camelCaseData = data.map(cliente => ({
            idCliente: cliente['IdCliente'],
            rfc: cliente['RFC'],
            razonSocial: cliente['RazonSocial'],
            pais: cliente['Pais'],
            idEstado: cliente['IdEstado'],
            idMunicipio: cliente['IdMunicipio'],
            ciudad: cliente['Ciudad'],
            colonia: cliente['Colonia'],
            calle: cliente['Calle'],
            codigoPostal: cliente['CodigoPostal'],
            numeroExterior: cliente['NumeroExterior'],
            numeroInterior: cliente['NumeroInterior'],
            referencia: cliente['Referencia'],
            idMetodoDePago: cliente['IdMetodoDePago'],
            idUsoCFDI: cliente['IdUsoCFDI'],
            idFormaPago: cliente['IdFormaPago'],
            idRegimenFiscal: cliente['IdRegimenFiscal']
          }));
          this.dataSource.data = camelCaseData;
          this.dataSource.paginator = this.paginator;
          this.dataSource.sort = this.sort;
        },
        error: (err) => {
          this.mostrarNotificacion('Error al cargar clientes: ' + (err.error?.message || err.message));
        }
      });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
    
    // ¡CAMBIO! Aplicamos el filtro para camelCase
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

  eliminarCliente(idCliente: number): void {
    if (confirm('¿Estás seguro de que deseas eliminar este cliente?')) {
      this.clienteService.deleteCliente(idCliente).subscribe({
        next: () => {
          this.mostrarNotificacion('Cliente eliminado con éxito');
          this.cargarClientes();
        },
        error: (err) => {
          this.mostrarNotificacion('Error al eliminar cliente: ' + (err.error?.message || err.message));
        }
      });
    }
  }

  mostrarNotificacion(mensaje: string) {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 });
  }
}