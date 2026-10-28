import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { debounceTime, distinctUntilChanged, finalize, of, startWith, switchMap } from 'rxjs';
import { Cliente } from '../cliente/cliente.interface';
import { Producto } from '../producto/producto.interface';
import { ClienteService } from '../services/cliente.service';
import { CrmService, UnidadCliente } from '../services/crm.service';
import { Disponibilidad, PedidoService } from '../services/pedido.service';
import { ProductoService } from '../services/producto.service';

interface DraftLine { producto: Producto; cantidad: number; valorUnitario: number; disponibilidad?: Disponibilidad; }

@Component({
  selector: 'app-pedido-create-dialog', standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, MatAutocompleteModule, MatButtonModule, MatDialogModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  templateUrl: './pedido-create-dialog.component.html', styleUrl: './pedido-create-dialog.component.css',
})
export class PedidoCreateDialogComponent {
  private readonly fb = inject(FormBuilder); private readonly clientesApi = inject(ClienteService);
  private readonly productosApi = inject(ProductoService); private readonly crm = inject(CrmService);
  private readonly pedidos = inject(PedidoService); private readonly ref = inject(MatDialogRef<PedidoCreateDialogComponent>);
  private readonly snack = inject(MatSnackBar); private readonly destroyRef = inject(DestroyRef);
  readonly clientes = signal<Cliente[]>([]); readonly unidades = signal<UnidadCliente[]>([]); readonly lineas = signal<DraftLine[]>([]);
  readonly guardando = signal(false); readonly error = signal('');
  readonly form = this.fb.group({ idCliente: [null as number | null, Validators.required], idUnidad: [null as number | null], notas: ['', Validators.maxLength(2000)] });
  readonly productoControl = this.fb.control<string | Producto>('');
  readonly productos$ = this.productoControl.valueChanges.pipe(startWith(''), debounceTime(250), distinctUntilChanged(), switchMap(value => {
    const term = typeof value === 'string' ? value.trim() : '';
    return term.length >= 2 ? this.productosApi.buscarProductos(term, 12) : of([]);
  }));
  readonly subtotal = () => this.lineas().reduce((sum, l) => sum + l.cantidad * l.valorUnitario, 0);

  constructor() {
    this.clientesApi.getClientes().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: value => this.clientes.set(value), error: () => this.error.set('No se pudieron cargar los clientes.') });
    this.form.controls.idCliente.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(id => {
      this.form.controls.idUnidad.setValue(null); this.unidades.set([]);
      if (id) this.crm.getUnidadesCliente(id).subscribe({ next: units => this.unidades.set(units) });
    });
  }
  displayProduct = (value: string | Producto | null) => typeof value === 'object' && value ? `${value.codigo} · ${value.descripcion}` : value || '';
  add(product: Producto) {
    if (this.lineas().some(line => line.producto.idProducto === product.idProducto)) { this.error.set('Ese producto ya está agregado.'); return; }
    const line: DraftLine = { producto: product, cantidad: 1, valorUnitario: Number(product.precioUnitario) };
    this.lineas.update(lines => [...lines, line]); this.productoControl.setValue(''); this.error.set('');
    this.pedidos.availability(product.idProducto).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => { line.disponibilidad = value; this.lineas.update(lines => [...lines]); });
  }
  remove(index: number) { this.lineas.update(lines => lines.filter((_, i) => i !== index)); }
  save() {
    if (this.form.invalid || !this.lineas().length || this.guardando()) { this.form.markAllAsTouched(); this.error.set(!this.lineas().length ? 'Agrega al menos un producto.' : 'Revisa los datos del pedido.'); return; }
    if (this.lineas().some(l => !Number.isFinite(l.cantidad) || l.cantidad <= 0 || !Number.isFinite(l.valorUnitario) || l.valorUnitario < 0)) { this.error.set('Revisa cantidades y precios.'); return; }
    const raw = this.form.getRawValue(); this.guardando.set(true); this.error.set('');
    this.pedidos.create({ requestId: crypto.randomUUID(), idCliente: raw.idCliente!, idUnidad: raw.idUnidad, notas: raw.notas?.trim() || '',
      partidas: this.lineas().map(l => ({ idProducto: l.producto.idProducto, cantidad: l.cantidad, valorUnitario: l.valorUnitario })) })
      .pipe(finalize(() => this.guardando.set(false)), takeUntilDestroyed(this.destroyRef)).subscribe({
        next: result => { this.snack.open('Pedido creado como borrador', 'Cerrar', { duration: 2500 }); this.ref.close(result.idPedido); },
        error: err => this.error.set(err.error?.message || 'No se pudo crear el pedido.'),
      });
  }
}
