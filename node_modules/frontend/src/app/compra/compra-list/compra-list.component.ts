// frontend/src/app/compra/compra-list/compra-list.component.ts
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
import { CompraService } from '../../services/compra.service';
import { CompraResumen } from '../compra.interface';
import { CompraDetalleComponent } from '../compra-detalle/compra-detalle.component';

@Component({
  selector: 'app-compra-list',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatCardModule, MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatDialogModule
  ],
  templateUrl: './compra-list.component.html',
})
export class CompraListComponent implements OnInit {
  
  displayedColumns: string[] = ['fecha', 'proveedor', 'folio', 'total', 'acciones'];
  dataSource = new MatTableDataSource<CompraResumen>();

  @ViewChild(MatPaginator) paginator!: MatPaginator;
  @ViewChild(MatSort) sort!: MatSort;

  constructor(
    private compraService: CompraService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.compraService.getCompras().subscribe(data => {
      this.dataSource.data = data;
      this.dataSource.paginator = this.paginator;
      this.dataSource.sort = this.sort;
    });
  }

  applyFilter(event: Event) {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dataSource.filter = filterValue.trim().toLowerCase();
  }

  verDetalle(compra: CompraResumen) {
    this.dialog.open(CompraDetalleComponent, { width: '600px', data: compra });
  }
}