// frontend/src/app/venta/factura-detalle/factura-detalle.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { VentaService } from '../../services/venta.service';
import { FacturaResumen } from '../venta.interface';

@Component({
  selector: 'app-factura-detalle',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatTableModule, MatButtonModule, MatIconModule],
  templateUrl: './factura-detalle.component.html',
})
export class FacturaDetalleComponent implements OnInit {
  
  detalles: any[] = [];
  displayedColumns: string[] = ['cant', 'unidad', 'desc', 'precio', 'importe'];
  isLoading = true;

  constructor(
    public dialogRef: MatDialogRef<FacturaDetalleComponent>,
    @Inject(MAT_DIALOG_DATA) public data: FacturaResumen, // Recibimos el resumen (folio, total, etc.)
    private ventaService: VentaService
  ) {}

  ngOnInit(): void {
    this.ventaService.getDetalleFactura(this.data.id_factura).subscribe({
      next: (res) => {
        this.detalles = res;
        this.isLoading = false;
      },
      error: (err) => console.error(err)
    });
  }

  cerrar() {
    this.dialogRef.close();
  }

  imprimirTicket() {
    this.ventaService.descargarPdf(this.data.id_factura).subscribe(blob => {
      const url = window.URL.createObjectURL(blob);
      window.open(url); // Abre en nueva pestaña
    });
  }
}