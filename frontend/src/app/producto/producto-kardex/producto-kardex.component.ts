import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ProductoService } from '../../services/producto.service';
import { Producto, KardexItem } from '../producto.interface'; // Importar KardexItem
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChangeDetectorRef } from '@angular/core';
import { AjusteInventarioDialogComponent } from './ajuste-inventario-dialog.component';

@Component({
  selector: 'app-producto-kardex',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatTableModule, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './producto-kardex.component.html',
})
export class ProductoKardexComponent implements OnInit {
  
  protected readonly Number = Number;

  movimientos: KardexItem[] = [];
  isLoading = true;
  
  displayedColumns: string[] = ['fecha', 'tipo', 'referencia', 'precio', 'cantidad', 'stock'];

  constructor(
    public dialogRef: MatDialogRef<ProductoKardexComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Producto,
    private productoService: ProductoService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.cargarMovimientos();
  }

  cargarMovimientos() {
    this.isLoading = true;
    this.productoService.getKardex(this.data.idProducto).subscribe({
      next: (res: any) => {
        this.movimientos = res.data || res;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error cargando kardex', err);
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  abrirAjusteManual() {
    const ref = this.dialog.open(AjusteInventarioDialogComponent, {
      width: '450px',
      data: this.data
    });

    ref.afterClosed().subscribe(res => {
      if (res && res.success) {
        // Recalcular existencia localmente en la cabecera
        this.data.existencia = res.nuevaExistencia;
        // Recargar los movimientos del Kardex
        this.cargarMovimientos();
      }
    });
  }

  // Helper para asignar colores según el tipo de movimiento
  getBadgeClass(tipo: string): string {
    switch (tipo) {
      case 'COMPRA': return 'bg-green-100 text-green-800 border-green-200';
      case 'VENTA': return 'bg-red-100 text-red-800 border-red-200';
      case 'CAMBIO_PRECIO': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'AJUSTE_MANUAL_STOCK': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'ENTRADA POR AJUSTE': return 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300';
      case 'SALIDA POR MERMA/AJUSTE': return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  }
}