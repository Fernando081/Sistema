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
  styleUrls: ['../../shared/list-page.css', './producto-kardex.component.css'],
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
      next: (res) => {
        this.movimientos = res;
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

  /** Etiqueta legible del tipo de movimiento (el valor técnico viene del ENUM de la base). */
  tipoLabel(tipo: string): string {
    const labels: Record<string, string> = { COMPRA: 'Compra', VENTA: 'Venta', CAMBIO_PRECIO: 'Cambio de precio', AJUSTE_MANUAL_STOCK: 'Ajuste manual', INVENTARIO_INICIAL: 'Inventario inicial', 'ENTRADA POR AJUSTE': 'Entrada por ajuste', 'SALIDA POR MERMA/AJUSTE': 'Salida por merma' };
    return labels[tipo] ?? tipo;
  }

  badgeClass(tipo: string): string {
    switch (tipo) {
      case 'COMPRA': return 'badge-success';
      case 'VENTA': return 'badge-danger';
      case 'AJUSTE_MANUAL_STOCK': case 'SALIDA POR MERMA/AJUSTE': return 'badge-warning';
      default: return 'badge-info';
    }
  }
}