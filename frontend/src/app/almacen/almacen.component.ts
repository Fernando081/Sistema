import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { debounceTime, distinctUntilChanged, forkJoin } from 'rxjs';
import { Cliente } from '../cliente/cliente.interface';
import { Producto } from '../producto/producto.interface';
import { Almacen, AlmacenService, CascoRecuperable, ConteoInventario, ExistenciaUbicacion, KitInventario, Ubicacion } from '../services/almacen.service';
import { ClienteService } from '../services/cliente.service';
import { ProductoService } from '../services/producto.service';
import { NotificationService } from '../shared/notification.service';

@Component({ selector: 'app-almacen', standalone: true, imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatTabsModule], templateUrl: './almacen.component.html', styleUrl: './almacen.component.css' })
export class AlmacenComponent {
  private readonly api = inject(AlmacenService); private readonly productsApi = inject(ProductoService); private readonly clientsApi = inject(ClienteService); private readonly fb = inject(FormBuilder); private readonly notice = inject(NotificationService);
  readonly warehouses = signal<Almacen[]>([]); readonly locations = signal<Ubicacion[]>([]); readonly stock = signal<ExistenciaUbicacion[]>([]); readonly products = signal<Producto[]>([]); readonly clients = signal<Cliente[]>([]);
  readonly lots = signal<Array<Record<string, string | number | null>>>([]); readonly serials = signal<Array<Record<string, string | number | null>>>([]); readonly counts = signal<ConteoInventario[]>([]); readonly kits = signal<KitInventario[]>([]); readonly cores = signal<CascoRecuperable[]>([]);
  readonly label = signal<Record<string, string | number> | null>(null); readonly labelType = signal<'Producto' | 'Ubicación'>('Producto'); readonly showLocation = signal(false); readonly search = this.fb.nonNullable.control('');
  readonly transfer = this.fb.nonNullable.group({ idProducto: [0, Validators.min(1)], idOrigen: [0, Validators.min(1)], idDestino: [0, Validators.min(1)], cantidad: [1, Validators.min(.000001)], motivo: ['Reubicación operativa', Validators.required] });
  readonly count = this.fb.nonNullable.group({ idUbicacion: [0, Validators.min(1)], idProducto: [0, Validators.min(1)], cantidadContada: [0, Validators.min(0)], tipo: 'Ciclico', notas: '' });
  readonly location = this.fb.nonNullable.group({ idAlmacen: [0, Validators.min(1)], codigo: ['', Validators.required], zona: '', pasillo: '', anaquel: '', nivel: '', contenedor: '' });
  readonly lot = this.fb.nonNullable.group({ idProducto: [0, Validators.min(1)], idUbicacion: [0, Validators.min(1)], lote: ['', Validators.required], fechaCaducidad: '', cantidad: [0, Validators.min(0)] });
  readonly serial = this.fb.nonNullable.group({ idProducto: [0, Validators.min(1)], idUbicacion: [0, Validators.min(1)], numeroSerie: ['', Validators.required], notas: '' });
  readonly kit = this.fb.nonNullable.group({ idKit: [0, Validators.min(1)], componentes: this.fb.array([this.kitLine()]) }); readonly kitMove = this.fb.nonNullable.group({ idKit: [0, Validators.min(1)], cantidad: [1, Validators.min(.000001)] });
  readonly core = this.fb.nonNullable.group({ idProducto: [0, Validators.min(1)], idCliente: [0], deposito: [0, Validators.min(0)], referencia: '', notas: '' }); readonly labelForm = this.fb.nonNullable.group({ tipo: 'Producto', id: [0, Validators.min(1)] });

  constructor() { forkJoin({ p: this.productsApi.buscarProductos('', 100), c: this.clientsApi.getClientes() }).subscribe(({ p, c }) => { this.products.set(p); this.clients.set(c); }); this.search.valueChanges.pipe(debounceTime(250), distinctUntilChanged()).subscribe(q => this.api.existencias(q).subscribe({ next: x => this.stock.set(x), error: () => this.notice.show('No se pudo buscar la existencia.') })); this.load(); }
  get kitLines() { return this.kit.controls.componentes as FormArray; }
  kitLine() { return this.fb.nonNullable.group({ idProducto: [0, Validators.min(1)], cantidad: [1, Validators.min(.000001)] }); }
  addKitLine() { this.kitLines.push(this.kitLine()); } removeKitLine(i: number) { if (this.kitLines.length > 1) this.kitLines.removeAt(i); }
  load() { forkJoin({ a: this.api.almacenes(), u: this.api.ubicaciones(), s: this.api.existencias(), l: this.api.lotes(), n: this.api.series(), co: this.api.conteos(), k: this.api.kits(), ca: this.api.cascos() }).subscribe({ next: x => { this.warehouses.set(x.a); this.locations.set(x.u); this.stock.set(x.s); this.lots.set(x.l); this.serials.set(x.n); this.counts.set(x.co); this.kits.set(x.k); this.cores.set(x.ca); }, error: () => this.notice.show('No se pudo cargar el almacén.') }); }
  saveLocation() { if (this.location.invalid) return; this.api.crearUbicacion(this.location.getRawValue()).subscribe({ next: () => { this.notice.show('Ubicación creada.', 3500, 'info'); this.showLocation.set(false); this.load(); }, error: () => this.notice.show('No se pudo crear la ubicación.') }); }
  move() { if (this.transfer.invalid) return; const r = this.transfer.getRawValue(); if (r.idOrigen === r.idDestino) return this.notice.show('Selecciona ubicaciones distintas.'); this.api.transferir({ ...r, requestId: crypto.randomUUID() }).subscribe({ next: () => { this.notice.show('Transferencia registrada.', 3500, 'info'); this.load(); }, error: () => this.notice.show('No se pudo transferir; revisa la existencia de origen.') }); }
  applyCount() { if (this.count.invalid) return; const r = this.count.getRawValue(); this.api.capturarConteo({ requestId: crypto.randomUUID(), idUbicacion: r.idUbicacion, tipo: r.tipo, ciego: true, notas: r.notas, partidas: [{ idProducto: r.idProducto, cantidadContada: r.cantidadContada }] }).subscribe({ next: () => { this.notice.show('Conteo enviado para autorización.', 4000, 'info'); this.count.reset({ idUbicacion: 0, idProducto: 0, cantidadContada: 0, tipo: 'Ciclico', notas: '' }); this.load(); }, error: () => this.notice.show('No se pudo capturar el conteo.') }); }
  resolveCount(id: number, approve: boolean) { this.api.resolverConteo(id, approve, approve ? undefined : 'Diferencia requiere nuevo conteo').subscribe({ next: () => { this.notice.show(approve ? 'Conteo autorizado e inventario actualizado.' : 'Conteo rechazado.', 4000, 'info'); this.load(); }, error: () => this.notice.show('No se pudo resolver el conteo.') }); }
  saveLot() { if (this.lot.invalid) return; const r = this.lot.getRawValue(); this.api.registrarLote({ ...r, fechaCaducidad: r.fechaCaducidad || undefined }).subscribe({ next: () => { this.notice.show('Lote registrado.', 3500, 'info'); this.load(); }, error: () => this.notice.show('No se pudo registrar el lote.') }); }
  saveSerial() { if (this.serial.invalid) return; this.api.registrarSerie(this.serial.getRawValue()).subscribe({ next: () => { this.notice.show('Número de serie registrado.', 3500, 'info'); this.load(); }, error: () => this.notice.show('El número de serie ya existe o los datos no son válidos.') }); }
  saveKit() { if (this.kit.invalid) return this.kit.markAllAsTouched(); const r = this.kit.getRawValue(); this.api.guardarKit(r.idKit, { componentes: r.componentes }).subscribe({ next: () => { this.notice.show('Composición del kit guardada.', 3500, 'info'); this.load(); }, error: () => this.notice.show('No se pudo guardar el kit.') }); }
  moveKit(tipo: 'armar' | 'desarmar') { if (this.kitMove.invalid) return; const r = this.kitMove.getRawValue(); this.api.moverKit(r.idKit, tipo, { requestId: crypto.randomUUID(), cantidad: r.cantidad }).subscribe({ next: () => { this.notice.show(tipo === 'armar' ? 'Kit armado y existencias actualizadas.' : 'Kit desarmado y componentes recuperados.', 4000, 'info'); this.load(); }, error: () => this.notice.show('No se pudo procesar el kit; revisa las existencias.') }); }
  saveCore() { if (this.core.invalid) return this.core.markAllAsTouched(); const r = this.core.getRawValue(); this.api.crearCasco({ ...r, idCliente: r.idCliente > 0 ? r.idCliente : undefined }).subscribe({ next: () => { this.notice.show('Casco recuperable registrado.', 3500, 'info'); this.core.reset({ idProducto: 0, idCliente: 0, deposito: 0, referencia: '', notas: '' }); this.load(); }, error: () => this.notice.show('No se pudo registrar el casco.') }); }
  nextCore(c: CascoRecuperable) { const next: Record<string, string> = { Pendiente: 'Recibido', Recibido: 'Enviado', Enviado: 'Acreditado' }; const estado = next[c.estado]; if (!estado) return; this.api.actualizarCasco(c.idCasco, estado).subscribe({ next: () => { this.notice.show(`Casco marcado como ${estado}.`, 3500, 'info'); this.load(); }, error: () => this.notice.show('No se pudo actualizar el casco.') }); }
  previewLabel() { if (this.labelForm.invalid) return; const r = this.labelForm.getRawValue(); const req = r.tipo === 'Producto' ? this.api.etiquetaProducto(r.id) : this.api.etiquetaUbicacion(r.id); req.subscribe({ next: x => { this.labelType.set(r.tipo as 'Producto' | 'Ubicación'); this.label.set(x); }, error: () => this.notice.show('No se pudo generar la etiqueta.') }); }
  printLabel() { window.print(); }
}
