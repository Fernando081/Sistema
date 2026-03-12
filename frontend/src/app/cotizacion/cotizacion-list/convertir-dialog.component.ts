import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { FormaPago, MetodoPago } from '../../services/catalogos.service';

@Component({
  selector: 'app-convertir-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
    FormsModule
  ],
  templateUrl: './convertir-dialog.component.html',
})
export class ConvertirDialogComponent {
  idFormaPago: number | null = null;
  idMetodoPago: number | null = null;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { 
      folio: string, 
      formasPago: FormaPago[], 
      metodosPago: MetodoPago[] 
    }
  ) {
    // Default to 'Efectivo' (01) and 'PUE' (Pago en una sola exhibición) if available
    const pu = this.data.metodosPago.find(m => m.clave === 'PUE');
    if (pu) this.idMetodoPago = pu.idMetodoDePago;

    const ef = this.data.formasPago.find(f => f.clave === '01');
    if (ef) this.idFormaPago = ef.idFormaPago;
  }
}
