// frontend/src/app/venta/factura-detalle/factura-detalle.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { ChangeDetectorRef } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { VentaService } from '../../services/venta.service';
import { FacturaResumen, DetalleFacturaDb } from '../venta.interface';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';

@Component({
  selector: 'app-factura-detalle',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatTableModule, MatButtonModule, MatIconModule, MatSnackBarModule],
  templateUrl: './factura-detalle.component.html',
})
export class FacturaDetalleComponent implements OnInit {
  detalles: DetalleFacturaDb[] = [];
  displayedColumns: string[] = ['cant', 'unidad', 'desc', 'precio', 'importe'];
  isLoading = true;

  constructor(
    public dialogRef: MatDialogRef<FacturaDetalleComponent>,
    @Inject(MAT_DIALOG_DATA) public data: FacturaResumen, // Recibimos el resumen (folio, total, etc.)
    private ventaService: VentaService,
    private cdr: ChangeDetectorRef,
    private snackBar: MatSnackBar,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.ventaService.getDetalleFactura(this.data.id_factura).subscribe({
      next: (res) => {
        this.detalles = res;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => console.error(err),
    });
  }

  cerrar() {
    this.dialogRef.close();
  }

  imprimirTicket() {
    this.ventaService.descargarPdf(this.data.id_factura).subscribe((blob) => {
      const url = window.URL.createObjectURL(blob);
      window.open(url); // Abre en nueva pestaña
    });
  }

  cancelarFactura() {
    const confirmRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: { message: '¿Está seguro de que desea cancelar esta factura? Esta acción devolverá el stock al inventario y eliminará los pagos asociados.' }
    });

    confirmRef.afterClosed().subscribe(result => {
      if (result) {
        this.ventaService.cancelarFactura(this.data.id_factura).subscribe({
          next: (res: any) => {
            const msg = res.data?.message || res.message || 'Factura cancelada con éxito';
            this.snackBar.open(msg, 'OK', { duration: 3000 });
            this.cerrar();
          },
          error: (err: any) => {
            console.error(err);
            const errorMsg = err.error?.message || err.message || 'Error al cancelar la factura';
            this.snackBar.open(errorMsg, 'Cerrar', { duration: 5000 });
          }
        });
      }
    });
  }
}
