import { CommonModule } from '@angular/common';
import { Component, OnInit, signal, inject } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { finalize } from 'rxjs';
import { EstadoGarantia, Garantia, GarantiaService } from '../services/garantia.service';

@Component({
  selector: 'app-garantia-list', standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatCardModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatSnackBarModule, MatTableModule],
  templateUrl: './garantia-list.component.html',
})
export class GarantiaListComponent implements OnInit {
  readonly canEdit = inject(AuthService).getDecodedToken()?.role === 'admin';
  readonly saving = signal(false);
  readonly garantias = signal<Garantia[]>([]);
  readonly cargando = signal(false);
  readonly estados: EstadoGarantia[] = [
    'Recibida', 'En revision', 'Enviada proveedor', 'Aprobada', 'Rechazada', 'Cerrada',
  ];
  readonly displayedColumns = ['factura', 'cliente', 'producto', 'cantidad', 'motivo', 'compromiso', 'estado', 'resolucion', 'accion'];

  constructor(private readonly service: GarantiaService, private readonly snack: MatSnackBar) {}
  ngOnInit() { this.cargar(); }
  cargar() {
    this.cargando.set(true);
    this.service.getAll().pipe(finalize(() => this.cargando.set(false)))
      .subscribe({ next: rows => this.garantias.set(rows.map(row => ({ ...row, cantidad: Number(row.cantidad), fechaCompromiso: this.localDateTime(row.fechaCompromiso) }))), error: () => {} });
  }
  guardar(item: Garantia) {
    if (!this.canEdit || this.saving()) return;
    this.saving.set(true);
    this.service.update(item.idGarantia, { estado: item.estado, resolucion: item.resolucion, fechaCompromiso: new Date(item.fechaCompromiso).toISOString() })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => { this.snack.open('Garantía actualizada', 'Cerrar', { duration: 2500 }); this.cargar(); },
        error: () => this.cargar(),
      });
  }
  private localDateTime(value:string){const date=new Date(value);date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16)}
}
