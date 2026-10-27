import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectorRef, Component, Inject, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../auth/auth.service';
import { FiscalDocument, FiscalService } from '../../services/fiscal.service';
import { VentaService } from '../../services/venta.service';
import { GarantiaDialogComponent } from '../../garantia/garantia-dialog.component';
import { downloadDocument } from '../../shared/document-download';
import { FiscalCancelDialogComponent } from '../../shared/fiscal-cancel-dialog.component';
import { DevolucionDialogComponent } from './devolucion-dialog.component';
import { DetalleFacturaDb, FacturaResumen } from '../venta.interface';

@Component({
  selector: 'app-factura-detalle',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatTableModule, MatButtonModule, MatIconModule, MatSnackBarModule],
  templateUrl: './factura-detalle.component.html',
})
export class FacturaDetalleComponent implements OnInit {
  readonly isAdmin = inject(AuthService).getSessionIdentity()?.role === 'admin';
  isCanceling = false;
  isStamping = false;
  fiscalDocument?: FiscalDocument;
  detalles: DetalleFacturaDb[] = [];
  displayedColumns: string[] = ['cant', 'unidad', 'desc', 'precio', 'importe', 'garantia'];
  isLoading = true;

  constructor(
    public dialogRef: MatDialogRef<FacturaDetalleComponent>,
    @Inject(MAT_DIALOG_DATA) public data: FacturaResumen,
    private readonly ventaService: VentaService,
    private readonly fiscalService: FiscalService,
    private readonly cdr: ChangeDetectorRef,
    private readonly snackBar: MatSnackBar,
    private readonly dialog: MatDialog,
  ) {}

  ngOnInit(): void {
    this.ventaService.getDetalleFactura(this.data.id_factura).subscribe({
      next: res => { this.detalles = res; this.isLoading = false; this.cdr.detectChanges(); },
      error: () => { this.isLoading = false; this.cdr.detectChanges(); },
    });
    this.loadFiscalDocument();
  }

  private loadFiscalDocument() {
    this.fiscalService.document('facturas', this.data.id_factura).subscribe({
      next: document => { this.fiscalDocument = document; this.cdr.detectChanges(); },
      error: () => { this.fiscalDocument = undefined; this.cdr.detectChanges(); },
    });
  }

  cerrar() { this.dialogRef.close(); }

  imprimirTicket() {
    this.ventaService.descargarPdf(this.data.id_factura).subscribe(blob =>
      downloadDocument(blob, `Factura_${this.data.serie}${this.data.folio}.pdf`));
  }

  cancelarFactura() {
    if (!this.isAdmin || this.isCanceling) return;
    this.dialog.open(FiscalCancelDialogComponent, {
      width: '560px', data: { label: `factura ${this.data.serie}${this.data.folio}` },
    }).afterClosed().subscribe(result => {
      if (!result) return;
      this.isCanceling = true;
      this.ventaService.cancelarFactura(this.data.id_factura, result).subscribe({
        next: (response) => {
          const message = response.message || 'Solicitud procesada';
          this.snackBar.open(message, 'OK', { duration: 6000 });
          this.isCanceling = false;
          if (response.cancelled && (!response.fiscal || response.state === 'Cancelado')) this.cerrar();
          else this.loadFiscalDocument();
        },
        error: (error: HttpErrorResponse) => {
          this.isCanceling = false;
          this.snackBar.open(error.error?.message || error.message || 'Error al cancelar la factura', 'Cerrar', { duration: 6000 });
        },
      });
    });
  }

  timbrar() {
    if (!this.isAdmin || this.isStamping) return;
    this.isStamping = true;
    this.fiscalService.stamp('facturas', this.data.id_factura).subscribe({
      next: document => {
        this.fiscalDocument = document;
        this.isStamping = false;
        this.snackBar.open(document.estado === 'Timbrado' ? 'CFDI timbrado correctamente' : `Estado fiscal: ${document.estado}`, 'Cerrar', { duration: 5000 });
        this.cdr.detectChanges();
      },
      error: error => {
        this.isStamping = false;
        this.snackBar.open(error.error?.message || 'No fue posible timbrar el CFDI', 'Cerrar', { duration: 7000 });
        this.loadFiscalDocument();
      },
    });
  }

  descargarXml() {
    this.fiscalService.xml('facturas', this.data.id_factura).subscribe({
      next: blob => downloadDocument(blob, `CFDI_${this.data.serie}${this.data.folio}.xml`),
      error: error => this.snackBar.open(error.error?.message || 'XML no disponible', 'Cerrar', { duration: 4000 }),
    });
  }

  descargarAcuse() {
    this.fiscalService.acknowledgement('facturas', this.data.id_factura).subscribe({
      next: blob => downloadDocument(blob, `ACUSE_${this.data.serie}${this.data.folio}.xml`),
      error: error => this.snackBar.open(error.error?.message || 'Acuse no disponible', 'Cerrar', { duration: 4000 }),
    });
  }

  registrarGarantia(item: DetalleFacturaDb) {
    this.dialog.open(GarantiaDialogComponent, {
      width: '520px',
      data: {
        idFactura: this.data.id_factura,
        idConcepto: item.id_concepto,
        producto: `${item.codigo_producto} - ${item.descripcion_producto}`,
        cantidadDisponible: Number(item.cantidad) - Number(item.cantidad_devuelta || 0),
      },
    }).afterClosed().subscribe(saved => {
      if (saved) this.snackBar.open('Garantía registrada', 'Cerrar', { duration: 3000 });
    });
  }

  devolver(item: DetalleFacturaDb): void {
    if (!this.isAdmin) return;
    this.dialog.open(DevolucionDialogComponent, { width: '520px', data: { idFactura: this.data.id_factura, item } })
      .afterClosed().subscribe(saved => { if (saved) this.ngOnInit(); });
  }
}
