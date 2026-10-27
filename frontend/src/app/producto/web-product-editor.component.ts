import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { finalize } from 'rxjs';
import { environment } from '../../environments/environment';
import { productImageUrl } from '../shared/api-url';

interface CommercialProduct {
  equivalencias?: { id: number; codigo: string | null; nombre: string; marca: string | null }[];
  categoria?: string | null;
  codigo: string | null;
  nombre: string;
  marca: string | null;
  imagenes: string[];
  numerosParte: { tipo: string; fabricante: string | null; numero: string }[];
  aplicaciones: {
    fabricante: string | null;
    modelo: string | null;
    motor: string | null;
    desde: number | null;
    hasta: number | null;
    restricciones: string | null;
  }[];
}
interface Profile {
  snapshot?: {
    equivalencias?: { id: number }[];
    imagenes?: string[];
    especificaciones?: Specification[];
    fuenteCompatibilidad?: string | null;
    fuenteReferencias?: string | null;
  };
  slug: string;
  titulo: string;
  descripcion: string;
  version: number;
  estado: 'borrador' | 'listo' | 'retirado';
  datosRealesConfirmados: boolean;
  derechosImagenConfirmados: boolean;
  compatibilidadVerificada: boolean;
}
interface Specification {
  nombre: string;
  valor: string;
  unidad: string;
}
interface Preview {
  producto: CommercialProduct;
  ficha: Profile | null;
}

@Component({
  selector: 'app-web-product-editor',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './web-product-editor.component.html',
  styleUrl: './web-product-editor.component.css',
})
export class WebProductEditorComponent implements OnInit {
  readonly receiptLookupId = signal(0);
  readonly revokeConfirmed = signal(false);
  readonly receiptStatus = signal<{
    receiptId: number;
    version: number;
    sha256: string;
    revoked: boolean;
    active: boolean;
  } | null>(null);
  setReceiptLookup(value: string) {
    this.receiptLookupId.set(Number(value));
    this.receiptStatus.set(null);
    this.revokeConfirmed.set(false);
  }
  checkReceipt() {
    const id = this.receiptLookupId();
    if (
      !this.loaded() ||
      this.loading() ||
      this.saving() ||
      this.exporting() ||
      !Number.isSafeInteger(id) ||
      id < 1
    )
      return;
    this.exporting.set(true);
    this.receiptStatus.set(null);
    this.revokeConfirmed.set(false);
    this.http
      .get<{
        receiptId: number;
        version: number;
        sha256: string;
        revoked: boolean;
        active: boolean;
      }>(`${this.url}/approvals/${id}`)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.exporting.set(false)),
      )
      .subscribe({
        next: (status) => this.receiptStatus.set(status),
        error: (error: HttpErrorResponse) =>
          this.message.set(
            error.status === 404 ? 'Recibo no encontrado para esta ficha.' : this.errorText(error),
          ),
      });
  }
  revokeReceipt() {
    const status = this.receiptStatus();
    if (
      !status ||
      status.revoked ||
      !this.revokeConfirmed() ||
      this.exporting() ||
      this.loading() ||
      this.saving()
    )
      return;
    this.exporting.set(true);
    this.revokeConfirmed.set(false);
    this.http
      .post<{ revoked: boolean }>(`${this.url}/approvals/${status.receiptId}/revoke`, {
        confirmed: true,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.exporting.set(false)),
      )
      .subscribe({
        next: () => {
          this.receiptStatus.set({ ...status, revoked: true, active: false });
          this.message.set(
            'Recibo revocado. Las versiones del sitio ya activadas requieren retiro por separado.',
          );
        },
        error: (error: HttpErrorResponse) => {
          this.receiptStatus.set(null);
          this.message.set(this.errorText(error));
        },
      });
  }
  @Input({ required: true }) productId!: number;
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly exporting = signal(false);
  readonly approvalConfirmed = signal(false);
  readonly approvalReceipt = signal<{ id: number; timestamp: string; sha256: string } | null>(null);
  readonly product = signal<CommercialProduct | null>(null);
  readonly message = signal('');
  readonly conflict = signal(false);
  readonly loaded = signal(false);
  readonly version = signal(0);
  readonly state = signal<Profile['estado']>('borrador');
  readonly selectedImages = signal<string[]>([]);
  readonly selectedEquivalents = signal<number[]>([]);
  readonly brokenImages = signal<string[]>([]);
  readonly specifications = this.fb.array<
    ReturnType<WebProductEditorComponent['specificationGroup']>
  >([]);
  readonly imageUrl = productImageUrl;
  readonly form = this.fb.nonNullable.group({
    fuenteCompatibilidad: ['', [Validators.maxLength(500), Validators.pattern(/^[^<>]*$/)]],
    fuenteReferencias: ['', [Validators.maxLength(500), Validators.pattern(/^[^<>]*$/)]],
    slug: [
      '',
      [
        Validators.required,
        Validators.minLength(3),
        Validators.maxLength(160),
        Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/),
      ],
    ],
    titulo: [
      '',
      [
        Validators.required,
        Validators.minLength(8),
        Validators.maxLength(160),
        Validators.pattern(/^[^<>]+$/),
      ],
    ],
    descripcion: [
      '',
      [
        Validators.required,
        Validators.minLength(30),
        Validators.maxLength(6000),
        Validators.pattern(/^[^<>]+$/),
      ],
    ],
    datosRealesConfirmados: false,
    derechosImagenConfirmados: false,
    compatibilidadVerificada: false,
  });
  private get url() {
    return `${environment.apiBaseUrl}/web-catalog/admin/products/${this.productId}`;
  }
  canExport(): boolean {
    return (
      this.loaded() &&
      this.state() === 'listo' &&
      !this.loading() &&
      !this.saving() &&
      !this.exporting() &&
      !this.conflict() &&
      !this.form.dirty &&
      !this.specifications.dirty &&
      !this.requirements().length
    );
  }
  exportCandidate() {
    if (!this.canExport()) return;
    this.exporting.set(true);
    this.message.set('Preparando la descarga de la ficha guardada…');
    this.http
      .get<unknown>(`${this.url}/export-candidate`)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.exporting.set(false)),
      )
      .subscribe({
        next: (candidate) => {
          this.downloadCandidate(candidate);
          this.message.set(
            'Candidata descargada como borrador sin aprobación pública. Exportar no publica la ficha.',
          );
        },
        error: (error: HttpErrorResponse) => this.message.set(this.errorText(error)),
      });
  }
  approveCandidate() {
    if (!this.canExport() || !this.approvalConfirmed()) return;
    this.exporting.set(true);
    this.approvalConfirmed.set(false);
    this.approvalReceipt.set(null);
    this.receiptStatus.set(null);
    this.revokeConfirmed.set(false);
    this.http
      .post<{ raw: string; sha256: string; receipt: { id: number; timestamp: string } }>(
        `${this.url}/approve-candidate`,
        { version: this.version(), confirmed: true },
      )
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.exporting.set(false)),
      )
      .subscribe({
        next: (result) => {
          this.receiptLookupId.set(result.receipt.id);
          this.receiptStatus.set(null);
          this.revokeConfirmed.set(false);
          this.approvalReceipt.set({ ...result.receipt, sha256: result.sha256 });
          this.downloadRaw(result.raw, `ficha-aprobada-${this.productId}.json`);
          this.message.set(
            'Aprobación registrada y manifiesto descargado. El sitio no se ha activado; cambios posteriores requieren nueva revisión.',
          );
        },
        error: (error: HttpErrorResponse) => {
          this.conflict.set(error.status === 409);
          this.message.set(this.errorText(error));
        },
      });
  }
  downloadCandidate(candidate: unknown) {
    this.downloadRaw(JSON.stringify(candidate, null, 2), `ficha-candidata-${this.productId}.json`);
  }
  downloadRaw(raw: string, filename: string) {
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  ngOnInit() {
    for (const key of [
      'slug',
      'titulo',
      'descripcion',
      'fuenteCompatibilidad',
      'fuenteReferencias',
    ] as const)
      this.form.controls[key].valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.resetReview());
    this.load();
  }
  private resetReview() {
    this.receiptStatus.set(null);
    this.revokeConfirmed.set(false);
    this.approvalConfirmed.set(false);
    this.approvalReceipt.set(null);
    this.receiptStatus.set(null);
    this.revokeConfirmed.set(false);
    this.form.patchValue(
      {
        datosRealesConfirmados: false,
        derechosImagenConfirmados: false,
        compatibilidadVerificada: false,
      },
      { emitEvent: false },
    );
  }
  private specificationGroup(value: Specification = { nombre: '', valor: '', unidad: '' }) {
    return this.fb.nonNullable.group({
      nombre: [
        value.nombre,
        [
          Validators.required,
          Validators.minLength(2),
          Validators.maxLength(80),
          Validators.pattern(/^[^<>]+$/),
        ],
      ],
      valor: [
        value.valor,
        [Validators.required, Validators.maxLength(160), Validators.pattern(/^[^<>]+$/)],
      ],
      unidad: [
        value.unidad,
        [Validators.required, Validators.maxLength(30), Validators.pattern(/^[^<>]+$/)],
      ],
    });
  }
  addSpecification(value?: Specification) {
    if (this.specifications.length >= 30 || this.saving() || this.loading()) return;
    const group = this.specificationGroup(value);
    group.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.resetReview());
    this.specifications.push(group);
    this.resetReview();
  }
  removeSpecification(index: number) {
    this.specifications.removeAt(index);
    this.resetReview();
  }
  selectImage(path: string, checked: boolean) {
    this.selectedImages.update((images) =>
      checked ? [...new Set([...images, path])] : images.filter((image) => image !== path),
    );
    this.resetReview();
  }
  selectEquivalent(id: number, checked: boolean) {
    this.selectedEquivalents.update((ids) =>
      checked ? [...new Set([...ids, id])] : ids.filter((value) => value !== id),
    );
    this.resetReview();
  }
  imageFailed(path: string) {
    this.brokenImages.update((images) => [...new Set([...images, path])]);
  }
  load(keepText = false) {
    if (this.loading() || this.saving() || this.exporting()) return;
    this.loading.set(true);
    this.approvalConfirmed.set(false);
    this.approvalReceipt.set(null);
    this.receiptStatus.set(null);
    this.revokeConfirmed.set(false);
    this.message.set('');
    this.http
      .get<Preview>(this.url)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.loading.set(false)),
      )
      .subscribe({
        next: ({ producto, ficha }) => {
          this.product.set(producto);
          this.version.set(ficha?.version ?? 0);
          this.state.set(ficha?.estado ?? 'borrador');
          this.brokenImages.set([]);
          if (!keepText) {
            this.selectedEquivalents.set(
              ficha?.snapshot?.equivalencias?.map((item) => item.id) ?? [],
            );
            this.form.patchValue(
              {
                fuenteCompatibilidad: ficha?.snapshot?.fuenteCompatibilidad ?? '',
                fuenteReferencias: ficha?.snapshot?.fuenteReferencias ?? '',
              },
              { emitEvent: false },
            );
            this.selectedImages.set(ficha?.snapshot?.imagenes ?? producto.imagenes);
            this.specifications.clear();
            for (const value of ficha?.snapshot?.especificaciones ?? [])
              this.specifications.push(this.specificationGroup(value));
            for (const group of this.specifications.controls)
              group.valueChanges
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe(() => this.resetReview());
          }
          if (!keepText)
            this.form.patchValue(
              ficha ?? {
                slug: (producto.codigo ?? '')
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, ''),
                titulo: producto.nombre,
                descripcion: '',
                datosRealesConfirmados: false,
                derechosImagenConfirmados: false,
                compatibilidadVerificada: false,
              },
              { emitEvent: false },
            );
          else
            this.form.patchValue({
              datosRealesConfirmados: false,
              derechosImagenConfirmados: false,
              compatibilidadVerificada: false,
            });
          this.loaded.set(true);
          this.resetReview();
          this.conflict.set(false);
          if (keepText)
            this.message.set(
              'Versión actual cargada. Tu texto se conservó; revisa otra vez los datos y confirma antes de guardar.',
            );
        },
        error: (error: HttpErrorResponse) => this.message.set(this.errorText(error)),
      });
  }
  requirements(): string[] {
    const p = this.product();
    const f = this.form.getRawValue();
    const missing: string[] = [];
    if (!p?.codigo?.trim()) missing.push('Código del producto');
    if (!p?.marca?.trim()) missing.push('Marca');
    if (this.selectedEquivalents().some((id) => !p?.equivalencias?.some((item) => item.id === id)))
      missing.push('Reemplazar equivalencias retiradas del maestro');
    if (!this.selectedImages().length) missing.push('Seleccionar al menos una imagen');
    if (this.selectedImages().some((image) => !p?.imagenes.includes(image)))
      missing.push('Reemplazar imágenes que ya no pertenecen al maestro');
    if (this.selectedImages().some((image) => this.brokenImages().includes(image)))
      missing.push('Revisar imágenes que no cargaron');
    if (!f.datosRealesConfirmados) missing.push('Confirmar datos reales');
    if (!f.derechosImagenConfirmados) missing.push('Confirmar derechos de imágenes');
    if (!f.compatibilidadVerificada) missing.push('Confirmar compatibilidad');
    return missing;
  }
  save(estado: Profile['estado']) {
    if (!this.loaded() || this.loading() || this.saving() || this.exporting() || this.conflict())
      return;
    this.form.markAllAsTouched();
    this.specifications.markAllAsTouched();
    const specs = this.specifications.getRawValue();
    if (
      this.form.invalid ||
      this.specifications.invalid ||
      specs.some((item) => !item.nombre.trim() || !item.valor.trim() || !item.unidad.trim()) ||
      new Set(specs.map((item) => item.nombre.trim().toLocaleLowerCase('es'))).size !== specs.length
    ) {
      this.message.set(
        'Revisa URL, título, descripción y características. No se admite HTML ni nombres de características repetidos.',
      );
      return;
    }
    if (estado === 'listo' && this.requirements().length) {
      this.message.set('Completa los requisitos de revisión antes de marcar lista.');
      return;
    }
    this.saving.set(true);
    this.approvalConfirmed.set(false);
    this.approvalReceipt.set(null);
    this.receiptStatus.set(null);
    this.revokeConfirmed.set(false);
    this.form.disable({ emitEvent: false });
    this.specifications.disable({ emitEvent: false });
    this.message.set('');
    this.http
      .put<Profile>(this.url, {
        equivalencias: this.selectedEquivalents(),
        ...this.form.getRawValue(),
        imagenes: this.selectedImages(),
        especificaciones: this.specifications.getRawValue(),
        estado,
        version: this.version(),
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.saving.set(false);
          this.form.enable({ emitEvent: false });
          this.specifications.enable({ emitEvent: false });
        }),
      )
      .subscribe({
        next: (ficha) => {
          this.version.set(ficha.version);
          this.state.set(ficha.estado);
          this.form.markAsPristine();
          this.message.set('Ficha guardada. Todavía no hay publicación pública activa.');
        },
        error: (error: HttpErrorResponse) => {
          this.conflict.set(error.status === 409);
          this.message.set(this.errorText(error));
        },
      });
  }
  private errorText(error: HttpErrorResponse): string {
    if (error.status === 403) return 'Solo administradores pueden preparar fichas comerciales.';
    if (error.status === 409)
      return 'La versión cambió o la URL está ocupada. Tu texto se conserva: carga la versión actual y revisa la URL.';
    if (error.status === 400)
      return 'El servidor rechazó la ficha: revisa texto, confirmaciones e imágenes existentes.';
    return 'No se pudo completar la operación. Intenta de nuevo; tu texto se conserva.';
  }
}
