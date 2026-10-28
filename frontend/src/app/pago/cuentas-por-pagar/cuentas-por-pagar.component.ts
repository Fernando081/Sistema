import { FinancialRequestIntent } from '../../shared/financial-request-intent';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { forkJoin, finalize } from 'rxjs';
import {
  AbastecimientoService,
  OrdenCompra,
  OrdenCompraDetalle,
} from '../../services/abastecimiento.service';
import {
  CuentasProveedorService,
  SupplierDashboard,
  SupplierInvoice,
  SupplierInvoiceDetail,
} from '../../services/cuentas-proveedor.service';
import { NotificationService } from '../../shared/notification.service';
import { businessDate } from '../../shared/business-date';
import { downloadDocument } from '../../shared/document-download';
import { LegacySupplierDebt, PagoProveedorService } from '../../services/pago-proveedor.service';
import { ProveedorService } from '../../services/proveedor.service';
import { ConfirmService } from '../../shared/confirm.service';
import { BulkSelection } from '../../shared/bulk-selection';
import { MatCheckboxModule } from '@angular/material/checkbox';

interface SupplierOptionRow {
  IdProveedor?: number;
  idProveedor?: number;
  RazonSocial?: string;
  razonSocial?: string;
}

@Component({
  selector: 'app-cuentas-por-pagar',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatTabsModule,
    MatCheckboxModule,
  ],
  templateUrl: './cuentas-por-pagar.component.html',
  styleUrls: ['./cuentas-por-pagar.component.css', './cuentas-por-pagar.modals.css'],
})
export class CuentasPorPagarComponent {
  private readonly api = inject(CuentasProveedorService);
  private readonly supply = inject(AbastecimientoService);
  private readonly supplierApi = inject(ProveedorService);
  private readonly legacyApi = inject(PagoProveedorService);
  private readonly fb = inject(FormBuilder);
  private readonly notice = inject(NotificationService);
  private readonly confirm = inject(ConfirmService);
  readonly invoices = signal<SupplierInvoice[]>([]);
  /** U02.3 · Facturas por pagar marcadas para un pago agrupado (mismo proveedor y moneda). */
  readonly grouped = new BulkSelection<SupplierInvoice>(
    (f) => f.idFacturaProveedor,
    50,
    (f) => ['Aprobada', 'Parcialmente pagada'].includes(f.estado) && Number(f.saldo) > 0,
  );
  readonly showGrouped = signal(false);
  readonly groupedTotal = computed(() =>
    this.round(this.grouped.rows().reduce((sum, f) => sum + Number(f.saldo), 0)),
  );
  /** Mensaje cuando la selección no puede pagarse junta; vacío si es válida. */
  readonly groupedProblem = computed(() => {
    const rows = this.grouped.rows();
    if (rows.length < 2) return 'Selecciona al menos dos facturas';
    if (new Set(rows.map((f) => f.idProveedor)).size > 1)
      return 'Las facturas deben ser del mismo proveedor';
    if (new Set(rows.map((f) => f.moneda)).size > 1)
      return 'Las facturas deben estar en la misma moneda';
    return '';
  });
  readonly groupedForm = this.fb.nonNullable.group({
    fecha: [businessDate(), Validators.required],
    monto: [0, [Validators.required, Validators.min(0.01)]],
    formaPago: ['Transferencia', Validators.required],
    referencia: '',
    notas: '',
  });
  readonly dashboard = signal<SupplierDashboard | null>(null);
  readonly orders = signal<OrdenCompra[]>([]);
  readonly selectedOrder = signal<OrdenCompraDetalle | null>(null);
  readonly selectedInvoice = signal<SupplierInvoiceDetail | null>(null);
  readonly suppliers = signal<SupplierOptionRow[]>([]);
  readonly legacyDebts = signal<LegacySupplierDebt[]>([]);
  readonly legacySelected = signal<LegacySupplierDebt | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly showInvoice = signal(false);
  readonly showAdvance = signal(false);
  readonly showCredit = signal(false);
  xmlText = '';
  pdfFile?: File;
  readonly invoiceForm = this.fb.nonNullable.group({
    idOrden: [0, Validators.min(1)],
    serie: '',
    folio: ['', Validators.required],
    uuid: '',
    fechaEmision: [businessDate(), Validators.required],
    fechaVencimiento: ['', Validators.required],
    moneda: 'MXN',
    tipoCambio: [1, Validators.min(0.000001)],
    retenciones: [0, Validators.min(0)],
    observaciones: '',
    partidas: this.fb.array([] as ReturnType<CuentasPorPagarComponent['invoiceLine']>[]),
  });
  readonly paymentForm = this.fb.nonNullable.group({
    fecha: [businessDate(), Validators.required],
    monto: [0, Validators.min(0.01)],
    formaPago: 'Transferencia',
    referencia: '',
    notas: '',
    idProgramacion: 0,
  });
  readonly scheduleForm = this.fb.nonNullable.group({
    fechaProgramada: ['', Validators.required],
    monto: [0, Validators.min(0.01)],
    notas: '',
  });
  readonly cancellationForm = this.fb.nonNullable.group({
    motivo: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(1000)]],
  });
  readonly advanceForm = this.fb.nonNullable.group({
    idProveedor: [0, Validators.min(1)],
    idFacturaProveedor: 0,
    fecha: [businessDate(), Validators.required],
    monto: [0, Validators.min(0.01)],
    montoAplicar: 0,
    formaPago: 'Transferencia',
    referencia: '',
    notas: '',
  });
  readonly creditForm = this.fb.nonNullable.group({
    idProveedor: [0, Validators.min(1)],
    idFacturaProveedor: 0,
    uuid: '',
    folio: ['', Validators.required],
    fecha: [businessDate(), Validators.required],
    total: [0, Validators.min(0.01)],
    montoAplicar: 0,
    notas: '',
  });
  readonly legacyPaymentForm = this.fb.nonNullable.group({
    monto: [0, Validators.min(0.01)],
    formaPago: 'Transferencia',
    referencia: '',
    notas: '',
  });
  readonly providers = computed(() =>
    this.suppliers()
      .map((p) => ({
        id: Number(p.idProveedor ?? p.IdProveedor),
        name: String(p.razonSocial ?? p.RazonSocial),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es')),
  );
  constructor() {
    this.load();
  }
  get lines() {
    return this.invoiceForm.controls.partidas;
  }
  invoiceLine(
    p: { idDetalle: number; descripcion: string; cantidad: number; costoUnitario: number },
    quantity?: number,
  ) {
    return this.fb.nonNullable.group({
      idOrdenDetalle: p.idDetalle,
      descripcion: p.descripcion,
      cantidad: [quantity ?? p.cantidad, Validators.min(0.000001)],
      costoUnitario: [Number(p.costoUnitario), Validators.min(0)],
      tasaIva: [0.16, Validators.min(0)],
    });
  }
  invoiceProduct(index: number) {
    const id = this.lines.at(index)?.getRawValue().idOrdenDetalle;
    return this.selectedOrder()?.partidas.find((p) => p.idDetalle === id);
  }
  removeInvoiceLine(index: number) {
    this.lines.removeAt(index);
  }
  eligibleInvoices(providerId: number) {
    return this.invoices().filter(
      (f) =>
        Number(f.idProveedor) === Number(providerId) &&
        ['Aprobada', 'Parcialmente pagada'].includes(f.estado),
    );
  }
  get calculated() {
    const raw = this.lines.getRawValue();
    const subtotal = this.round(raw.reduce((s, p) => s + p.cantidad * p.costoUnitario, 0));
    const impuestos = this.round(
      raw.reduce((s, p) => s + p.cantidad * p.costoUnitario * p.tasaIva, 0),
    );
    const total = this.round(subtotal + impuestos - this.invoiceForm.controls.retenciones.value);
    return { subtotal, impuestos, total };
  }
  private readonly intents = new FinancialRequestIntent();
  private intent(kind: string, payload: unknown) {
    try {
      return this.intents.begin(kind, payload);
    } catch (error) {
      this.notice.show(error instanceof Error ? error.message : 'Revisa la operación pendiente.');
      return null;
    }
  }
  private round(v: number) {
    return Math.round((v + Number.EPSILON) * 100) / 100;
  }
  load() {
    this.loading.set(true);
    forkJoin({
      i: this.api.invoices(),
      d: this.api.dashboard(),
      o: this.supply.ordenes(),
      p: this.supplierApi.getProveedores(),
      l: this.legacyApi.getAllDeuda(),
    })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (x) => {
          this.invoices.set(x.i);
          this.dashboard.set(x.d);
          this.orders.set(x.o);
          this.suppliers.set(x.p);
          this.legacyDebts.set(x.l);
        },
        error: () => this.notice.show('No se pudieron cargar las cuentas por pagar.'),
      });
  }
  selectOrder(id: number) {
    if (!id) return;
    this.supply.orden(id).subscribe({
      next: (o) => {
        this.selectedOrder.set(o);
        this.lines.clear();
        for (const p of o.partidas) {
          const available = Math.max(
            0,
            Number(p.cantidadRecibida) - Number(p.cantidadFacturada || 0),
          );
          if (available > 0) this.lines.push(this.invoiceLine(p, available));
        }
        this.invoiceForm.patchValue({ idOrden: o.idOrden });
        if (!this.lines.length)
          this.notice.show('La orden no tiene cantidades recibidas pendientes de facturar.');
      },
      error: () => this.notice.show('No se pudo abrir la orden.'),
    });
  }
  onXml(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) {
      this.xmlText = '';
      return;
    }
    if (file.size > 5_000_000) {
      this.notice.show('El XML supera 5 MB.');
      return;
    }
    file.text().then((text) => (this.xmlText = text));
  }
  onPdf(event: Event) {
    this.pdfFile = (event.target as HTMLInputElement).files?.[0];
  }
  saveInvoice() {
    if (this.saving()) return;
    const order = this.selectedOrder();
    if (!order || this.invoiceForm.invalid || !this.lines.length)
      return this.invoiceForm.markAllAsTouched();
    const raw = this.invoiceForm.getRawValue();
    this.saving.set(true);
    const payload = {
      ...raw,
      idProveedor: order.idProveedor,
      uuid: raw.uuid || undefined,
      xml: this.xmlText || undefined,
      ...this.calculated,
    };
    const key = this.intent('invoice', payload);
    if (!key) {
      this.saving.set(false);
      return;
    }
    this.api.create({ ...payload, requestId: key }).subscribe({
      next: (r) => {
        this.intents.success('invoice');
        const upload = this.pdfFile ? this.api.uploadPdf(r.idFacturaProveedor, this.pdfFile) : null;
        if (upload)
          upload.pipe(finalize(() => this.finishInvoice(r))).subscribe({
            error: () =>
              this.notice.show('La factura se guardó, pero el PDF no pudo resguardarse.'),
          });
        else this.finishInvoice(r);
      },
      error: (e) => {
        this.intents.failure('invoice', e.status);
        this.saving.set(false);
        this.notice.show(
          e.error?.message || 'Resultado pendiente. Reintenta con los mismos datos.',
        );
      },
    });
  }
  private finishInvoice(result: { estado: string; discrepancias: number }) {
    this.saving.set(false);
    this.notice.show(
      result.discrepancias
        ? `Factura guardada con ${result.discrepancias} discrepancias.`
        : 'Factura conciliada correctamente.',
      5000,
      'info',
    );
    this.showInvoice.set(false);
    this.selectedOrder.set(null);
    this.lines.clear();
    this.xmlText = '';
    this.pdfFile = undefined;
    this.load();
  }
  openInvoice(id: number) {
    this.api.invoice(id).subscribe({
      next: (x) => {
        this.selectedInvoice.set(x);
        const balance = Number(x.saldo_pendiente ?? x.saldo);
        this.paymentForm.patchValue({ monto: balance, idProgramacion: 0 });
        this.scheduleForm.patchValue({ monto: balance, fechaProgramada: x.fechaVencimiento });
      },
      error: () => this.notice.show('No se pudo abrir la factura.'),
    });
  }
  refreshInvoice() {
    const id = this.selectedInvoice()?.idFacturaProveedor;
    if (id) this.openInvoice(id);
  }
  resolve(id: number, estado: 'Aprobada' | 'Rechazada', reason: string) {
    if (reason.trim().length < 3) return this.notice.show('Escribe una justificación.');
    this.api.resolve(id, estado, reason.trim()).subscribe({
      next: () => {
        this.notice.show('Discrepancia resuelta.');
        this.refreshInvoice();
        this.load();
      },
      error: (e) => this.notice.show(e.error?.message || 'No se pudo resolver.'),
    });
  }
  approve() {
    const i = this.selectedInvoice();
    if (!i) return;
    this.api.approve(i.idFacturaProveedor).subscribe({
      next: () => {
        this.notice.show('Factura aprobada y liberada para pago.', 4500, 'info');
        this.refreshInvoice();
        this.load();
      },
      error: (e) => this.notice.show(e.error?.message || 'No se pudo aprobar.'),
    });
  }
  schedule() {
    const i = this.selectedInvoice();
    if (!i || this.scheduleForm.invalid) return;
    this.api.schedule(i.idFacturaProveedor, this.scheduleForm.getRawValue()).subscribe({
      next: () => {
        this.notice.show('Pago programado.');
        this.refreshInvoice();
      },
      error: (e) => this.notice.show(e.error?.message || 'No se pudo programar.'),
    });
  }
  openGrouped() {
    if (this.groupedProblem()) return;
    this.groupedForm.reset({
      fecha: businessDate(),
      monto: this.groupedTotal(),
      formaPago: 'Transferencia',
      referencia: '',
      notas: '',
    });
    this.showGrouped.set(true);
  }

  payGrouped() {
    if (this.saving() || this.groupedForm.invalid || this.groupedProblem()) return;
    const raw = this.groupedForm.getRawValue();
    if (this.round(raw.monto) > this.groupedTotal()) {
      this.notice.show('El pago supera la suma de saldos seleccionados.');
      return;
    }
    const idsFacturas = this.grouped.ids().sort((a, b) => a - b);
    // Monto igual a la suma: se liquida cada saldo completo; menor: el servidor reparte por vencimiento.
    const payload = {
      idsFacturas,
      fecha: raw.fecha,
      formaPago: raw.formaPago,
      monto: this.round(raw.monto) === this.groupedTotal() ? undefined : this.round(raw.monto),
      referencia: raw.referencia || undefined,
      notas: raw.notas || undefined,
    };
    const kind = 'grouped-payment';
    const key = this.intent(kind, payload);
    if (!key) return;
    this.saving.set(true);
    this.api
      .payGrouped({ ...payload, requestId: key })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (res) => {
          this.intents.success(kind);
          this.notice.show(res.message, 5000, 'info');
          this.showGrouped.set(false);
          this.grouped.clear();
          this.load();
        },
        error: (e) => {
          this.intents.failure(kind, e.status);
          this.notice.show(
            e.error?.message || 'Resultado pendiente. Reintenta con los mismos datos.',
          );
        },
      });
  }

  pay() {
    const i = this.selectedInvoice();
    if (this.saving() || !i || this.paymentForm.invalid) return;
    const raw = this.paymentForm.getRawValue();
    const payload = { ...raw, idProgramacion: raw.idProgramacion || undefined };
    const kind = 'payment';
    const key = this.intent(kind, { idFacturaProveedor: i.idFacturaProveedor, ...payload });
    if (!key) return;
    this.saving.set(true);
    this.api
      .pay(i.idFacturaProveedor, { ...payload, requestId: key })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.intents.success(kind);
          this.notice.show('Pago registrado.', 4000, 'info');
          this.refreshInvoice();
          this.load();
        },
        error: (e) => {
          this.intents.failure(kind, e.status);
          this.notice.show(
            e.error?.message || 'Resultado pendiente. Reintenta con los mismos datos.',
          );
        },
      });
  }
  reversePayment(id: number, reason: string) {
    const motivo = reason.trim();
    if (motivo.length < 5) return this.notice.show('Describe por qué se revierte el pago.');
    this.confirm
      .ask({
        title: 'Revertir pago',
        message:
          'Confirma que el dinero ya fue devuelto por el proveedor o recuperado en la cuenta correspondiente. El saldo de la factura volverá a quedar pendiente.',
        confirmLabel: 'Revertir pago',
        tone: 'danger',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.saving.set(true);
        this.api
          .reversePayment(id, motivo)
          .pipe(finalize(() => this.saving.set(false)))
          .subscribe({
            next: () => {
              this.notice.show('Pago revertido y saldo reabierto.', 4500, 'info');
              this.refreshInvoice();
              this.load();
            },
            error: (e) => this.notice.show(e.error?.message || 'No se pudo revertir el pago.'),
          });
      });
  }
  cancelInvoice() {
    const invoice = this.selectedInvoice();
    if (!invoice) return;
    if (this.cancellationForm.invalid) {
      this.cancellationForm.markAllAsTouched();
      return;
    }
    const motivo = this.cancellationForm.controls.motivo.value.trim();
    this.confirm
      .ask({
        title: 'Cancelar factura de proveedor',
        message:
          'Se cancelará la cuenta por pagar y se liberarán los anticipos o notas de crédito aplicados. Si existen pagos activos, primero deberán revertirse.',
        confirmLabel: 'Cancelar factura',
        tone: 'danger',
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.saving.set(true);
        this.api
          .cancel(invoice.idFacturaProveedor, motivo)
          .pipe(finalize(() => this.saving.set(false)))
          .subscribe({
            next: () => {
              this.notice.show(
                'Factura cancelada. Los saldos aplicados quedaron disponibles.',
                5000,
                'info',
              );
              this.cancellationForm.reset();
              this.refreshInvoice();
              this.load();
            },
            error: (e) => this.notice.show(e.error?.message || 'No se pudo cancelar la factura.'),
          });
      });
  }
  createAdvance() {
    if (this.saving() || this.advanceForm.invalid) return;
    const raw = this.advanceForm.getRawValue();
    const payload = {
      ...raw,
      idFacturaProveedor: raw.idFacturaProveedor || undefined,
      montoAplicar: raw.montoAplicar || undefined,
    };
    const key = this.intent('advance', payload);
    if (!key) return;
    this.saving.set(true);
    this.api
      .advance({ ...payload, requestId: key })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.intents.success('advance');
          this.notice.show('Operación registrada.');
          this.showAdvance.set(false);
          this.load();
        },
        error: (e) => {
          this.intents.failure('advance', e.status);
          this.notice.show(
            e.error?.message || 'Resultado pendiente. Reintenta con los mismos datos.',
          );
        },
      });
  }
  createCredit() {
    if (this.saving() || this.creditForm.invalid) return;
    const raw = this.creditForm.getRawValue();
    const payload = {
      ...raw,
      idFacturaProveedor: raw.idFacturaProveedor || undefined,
      montoAplicar: raw.montoAplicar || undefined,
      uuid: raw.uuid || undefined,
    };
    const key = this.intent('credit', payload);
    if (!key) return;
    this.saving.set(true);
    this.api
      .credit({ ...payload, requestId: key })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.intents.success('credit');
          this.notice.show('Operación registrada.');
          this.showCredit.set(false);
          this.load();
        },
        error: (e) => {
          this.intents.failure('credit', e.status);
          this.notice.show(
            e.error?.message || 'Resultado pendiente. Reintenta con los mismos datos.',
          );
        },
      });
  }
  download(id: number, type: 'xml' | 'pdf') {
    this.api[type](id).subscribe({
      next: (blob) => downloadDocument(blob, `factura_proveedor_${id}.${type}`),
      error: () => this.notice.show(`${type.toUpperCase()} no disponible.`),
    });
  }
  selectProgram(id: number, amount: number) {
    this.paymentForm.patchValue({ idProgramacion: id, monto: Number(amount) });
  }
  openLegacy(item: LegacySupplierDebt) {
    this.legacySelected.set(item);
    this.legacyPaymentForm.patchValue({
      monto: Number(item.saldo_pendiente),
      formaPago: 'Transferencia',
      referencia: '',
      notas: '',
    });
  }
  payLegacy() {
    const item = this.legacySelected();
    if (this.saving() || !item || this.legacyPaymentForm.invalid) return;
    const payload = { idCompra: item.id_compra, ...this.legacyPaymentForm.getRawValue() };
    const kind = 'legacy';
    const key = this.intent(kind, payload);
    if (!key) return;
    this.saving.set(true);
    this.legacyApi
      .registrar({ ...payload, requestId: key })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: () => {
          this.intents.success(kind);
          this.notice.show('Pago histórico registrado.', 4000, 'info');
          this.legacySelected.set(null);
          this.load();
        },
        error: (e) => {
          this.intents.failure(kind, e.status);
          this.notice.show(
            e.error?.message || 'Resultado pendiente. Reintenta con los mismos datos.',
          );
        },
      });
  }
}
