import { Component, Inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule, MatTableDataSource } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { ProductoService } from '../../services/producto.service';
import { ProveedorService } from '../../services/proveedor.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { trigger, state, style, transition, animate } from '@angular/animations';

import { CotizacionProveedor, CotizacionProveedorGrupo } from '../../services/producto-api.types';

import { Proveedor } from '../../proveedor/proveedor.interface';

@Component({
  selector: 'app-producto-cotizaciones-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule,
    MatIconModule
  ],
  templateUrl: './producto-cotizaciones-dialog.component.html',
  animations: [
    trigger('detailExpand', [
      state('collapsed', style({ height: '0px', minHeight: '0', visibility: 'hidden' })),
      state('expanded', style({ height: '*', visibility: 'visible' })),
      transition('expanded <=> collapsed', animate('225ms cubic-bezier(0.4, 0.0, 0.2, 1)')),
    ]),
  ],
})
export class ProductoCotizacionesDialogComponent implements OnInit {

  // Signals
  cotizaciones = signal<CotizacionProveedor[]>([]);
  isSaving = signal<boolean>(false);
  proveedores: Proveedor[] = [];
  
  historialDataSource = new MatTableDataSource<CotizacionProveedorGrupo>();
  displayedColumns: string[] = ['fecha', 'proveedor', 'marca', 'dias', 'precio'];
  displayedColumnsWithExpand = [...this.displayedColumns, 'expand'];
  expandedElement: CotizacionProveedorGrupo | null = null;

  nuevaCotizacion = {
    idProveedor: null as number | null,
    marcaOfrecida: '',
    precioCotizado: null as number | null,
    diasEntrega: 0
  };

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { idProducto: number, productoNombre: string },
    private productoService: ProductoService,
    private proveedorService: ProveedorService,
    private snackBar: MatSnackBar
  ) {}

  ngOnInit(): void {
    this.loadHistorial();
    this.loadProveedores();
  }

  loadProveedores() {
    this.proveedorService.getProveedores().subscribe({
      next: (res) => {
        this.proveedores = res;
      },
      error: (e) => console.error('Error loading proveedores:', e)
    });
  }

  loadHistorial() {
    this.productoService.getCotizacionesProveedor(this.data.idProducto).subscribe({
      next: (res) => {
        // Agrupar por Proveedor y Marca
        const gruposMap = new Map<string, CotizacionProveedor[]>();
        res.forEach(c => {
          const marcaClean = (c.marca_ofrecida || 'GENERIC').toUpperCase().trim();
          const key = `${c.id_proveedor}-${marcaClean}`;
          if (!gruposMap.has(key)) gruposMap.set(key, []);
          gruposMap.get(key)!.push(c);
        });

        const activeRows: Omit<CotizacionProveedorGrupo, 'esMasBarato'>[] = [];
        let minPrice = Number.MAX_VALUE;

        // Construir filas principales
        for (const [key, groupItems] of gruposMap.entries()) {
          // El backend ya ordena por fecha DESC, el primero es el mas reciente
          const mostRecent = groupItems[0];
          
          // Actualizar el precio minimo global considerando SOLO las ofertas activas recientes
          const precioNum = Number(mostRecent.precio_cotizado);
          if (precioNum < minPrice) {
            minPrice = precioNum;
          }

          activeRows.push({ ...mostRecent, history: groupItems.slice(1) });
        }

        // Marcar el más barato
        const finalData = activeRows.map(row => ({
          ...row,
          esMasBarato: Number(row.precio_cotizado) === minPrice
        }));

        this.cotizaciones.set(res); // Guardar el crudo para count() global o UI states
        this.historialDataSource.data = finalData;
      },
      error: (e) => console.error(e)
    });
  }

  guardarCotizacion() {
    if (this.isSaving() || !this.nuevaCotizacion.idProveedor || this.nuevaCotizacion.precioCotizado === null || Number(this.nuevaCotizacion.precioCotizado) < 0 || this.nuevaCotizacion.diasEntrega < 0) return;
    
    this.isSaving.set(true);

    this.productoService.addCotizacionProveedor(this.data.idProducto, { ...this.nuevaCotizacion, idProveedor: this.nuevaCotizacion.idProveedor, precioCotizado: this.nuevaCotizacion.precioCotizado }).subscribe({
      next: () => {
        this.snackBar.open('Cotización guardada.', 'Cerrar', { duration: 3000 });
        this.isSaving.set(false);
        this.nuevaCotizacion.precioCotizado = null;
        this.nuevaCotizacion.marcaOfrecida = '';
        this.nuevaCotizacion.diasEntrega = 0;
        this.loadHistorial();
      },
      error: (e) => {
        console.error(e);
        this.snackBar.open('Error al guardar.', 'Cerrar');
        this.isSaving.set(false);
      }
    });
  }
}
