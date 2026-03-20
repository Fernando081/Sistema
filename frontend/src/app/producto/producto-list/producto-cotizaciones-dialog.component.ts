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
  cotizaciones = signal<any[]>([]);
  isSaving = signal<boolean>(false);
  proveedores: any[] = [];
  
  historialDataSource = new MatTableDataSource<any>();
  displayedColumns: string[] = ['fecha', 'proveedor', 'marca', 'dias', 'precio'];
  displayedColumnsWithExpand = [...this.displayedColumns, 'expand'];
  expandedElement: any | null = null;

  nuevaCotizacion = {
    idProveedor: null,
    marcaOfrecida: '',
    precioCotizado: null,
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
        const gruposMap = new Map<string, any[]>();
        res.forEach(c => {
          const marcaClean = (c.marca_ofrecida || 'GENERIC').toUpperCase().trim();
          const key = `${c.id_proveedor}-${marcaClean}`;
          if (!gruposMap.has(key)) gruposMap.set(key, []);
          gruposMap.get(key)!.push(c);
        });

        const activeRows: any[] = [];
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

          mostRecent.history = groupItems.length > 1 ? groupItems.slice(1) : []; // Los demás van al historial desplegable
          activeRows.push(mostRecent);
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
    if (!this.nuevaCotizacion.idProveedor || this.nuevaCotizacion.precioCotizado === null) return;
    
    this.isSaving.set(true);

    this.productoService.addCotizacionProveedor(this.data.idProducto, this.nuevaCotizacion).subscribe({
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
