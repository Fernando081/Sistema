// frontend/src/app/producto/producto-kardex/producto-kardex.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon'; // Importar icono
import { ProductoService } from '../../services/producto.service';
import { Producto } from '../producto.interface';

@Component({
  selector: 'app-producto-kardex',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatTableModule, MatButtonModule, MatIconModule],
  templateUrl: './producto-kardex.component.html',
})
export class ProductoKardexComponent implements OnInit {
  movimientos: any[] = [];
  displayedColumns: string[] = ['fecha', 'tipo', 'cantidad', 'referencia'];

  constructor(
    public dialogRef: MatDialogRef<ProductoKardexComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Producto,
    private productoService: ProductoService
  ) {}

  ngOnInit(): void {
    this.productoService.getKardex(this.data.idProducto).subscribe(res => {
      this.movimientos = res;
    });
  }
}