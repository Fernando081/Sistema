// frontend/src/app/producto/producto-kardex/producto-kardex.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ProductoService } from '../../services/producto.service';
import { Producto, KardexItem } from '../producto.interface'; // Importar KardexItem
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-producto-kardex',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatTableModule, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './producto-kardex.component.html',
})
export class ProductoKardexComponent implements OnInit {
  
  protected readonly Number = Number;

  movimientos: KardexItem[] = [];
  
  // Agregamos columnas nuevas: Precio Unitario y Stock Final
  displayedColumns: string[] = ['fecha', 'tipo', 'referencia', 'precio', 'cantidad', 'stock'];

  constructor(
    public dialogRef: MatDialogRef<ProductoKardexComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Producto,
    private productoService: ProductoService
  ) {}

  ngOnInit(): void {
    this.productoService.getKardex(this.data.idProducto).subscribe({
      next: (res) => {
        this.movimientos = res;
      },
      error: (err) => console.error('Error cargando kardex', err)
    });
  }

  // Helper para asignar colores según el tipo de movimiento
  getBadgeClass(tipo: string): string {
    switch (tipo) {
      case 'COMPRA': return 'bg-green-100 text-green-800 border-green-200';
      case 'VENTA': return 'bg-red-100 text-red-800 border-red-200';
      case 'CAMBIO_PRECIO': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'AJUSTE_MANUAL_STOCK': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  }
}