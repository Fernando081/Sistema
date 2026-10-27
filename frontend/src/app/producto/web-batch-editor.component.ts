import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize, forkJoin } from 'rxjs';
import { environment } from '../../environments/environment';
interface Member {
  productId: number;
  version: number;
}
interface EditorialImage {
  file: string;
  sha256: string;
  alt: string;
  width: number;
  height: number;
  authorized: boolean;
  variants?: EditorialImage[];
}
interface EditorialProduct extends Record<string, unknown> {
  slug: string;
  title: string;
  code: string;
  images?: EditorialImage[];
  alternatives?: string[];
}
interface BatchStatus {
  receiptId: number;
  active: boolean;
  revoked: boolean;
  sha256: string;
  productCount: number;
}
@Component({
  selector: 'app-web-batch-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './web-batch-editor.component.html',
  styleUrl: './web-batch-editor.component.css',
})
export class WebBatchEditorComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly url = `${environment.apiBaseUrl}/web-catalog/admin/products`;
  readonly busy = signal(false);
  readonly message = signal('');
  readonly members = signal<Member[]>([]);
  readonly status = signal<BatchStatus | null>(null);
  readonly products = signal<EditorialProduct[]>([]);
  readonly visualError = signal('');
  private readonly previews = new Map<string, string>();
  private readonly localFiles = new Map<string, Blob>();
  ids = '';
  raw = '';
  receipt = '';
  confirmed = false;
  revokeConfirmed = false;
  constructor() {
    this.destroyRef.onDestroy(() => this.clearPreviews());
  }
  private clearPreviews() {
    for (const url of this.previews.values()) URL.revokeObjectURL(url);
    this.previews.clear();
    this.localFiles.clear();
  }
  parseVisual() {
    this.changed();
    this.clearPreviews();
    try {
      const parsed = JSON.parse(this.raw) as { products?: EditorialProduct[] };
      if (
        !Array.isArray(parsed.products) ||
        parsed.products.length !== this.members().length ||
        parsed.products.some(
          (p) =>
            !p ||
            typeof p.slug !== 'string' ||
            typeof p.title !== 'string' ||
            typeof p.code !== 'string' ||
            (p.images !== undefined &&
              (!Array.isArray(p.images) ||
                p.images.some(
                  (i) =>
                    !i ||
                    typeof i.file !== 'string' ||
                    typeof i.alt !== 'string' ||
                    (i.variants !== undefined &&
                      (!Array.isArray(i.variants) ||
                        i.variants.length > 3 ||
                        i.variants.some(
                          (v) =>
                            !v ||
                            typeof v.file !== 'string' ||
                            typeof v.alt !== 'string' ||
                            v.variants !== undefined,
                        ))),
                ))) ||
            (p.alternatives !== undefined &&
              (!Array.isArray(p.alternatives) ||
                p.alternatives.some((a) => typeof a !== 'string'))),
        )
      )
        throw new Error();
      this.products.set(parsed.products);
      this.visualError.set('');
    } catch {
      this.products.set([]);
      this.visualError.set(
        'Manifiesto inválido para revisión visual. Corrige el JSON o prepara otra vez.',
      );
    }
  }
  syncVisual() {
    this.changed();
    const parsed = JSON.parse(this.raw) as Record<string, unknown>;
    this.raw = JSON.stringify({ ...parsed, products: this.products() }, null, 2);
    this.products.set([...this.products()]);
  }
  alternative(product: EditorialProduct, slug: string, selected: boolean) {
    product.alternatives = selected
      ? [...new Set([...(product.alternatives ?? []), slug])]
      : (product.alternatives ?? []).filter((value) => value !== slug);
    this.syncVisual();
  }
  preview(product: EditorialProduct, image: EditorialImage) {
    return this.previews.get(`${product.slug}/${image.file}`);
  }
  removeImage(product: EditorialProduct, image: EditorialImage) {
    for (const variant of image.variants ?? []) this.removeVariant(product, image, variant);
    const key = `${product.slug}/${image.file}`;
    const url = this.previews.get(key);
    if (url) URL.revokeObjectURL(url);
    this.previews.delete(key);
    this.localFiles.delete(key);
    product.images = (product.images ?? []).filter((value) => value !== image);
    this.syncVisual();
  }
  removeVariant(product: EditorialProduct, parent: EditorialImage, variant: EditorialImage) {
    const key = `${product.slug}/${variant.file}`;
    const url = this.previews.get(key);
    if (url) URL.revokeObjectURL(url);
    this.previews.delete(key);
    this.localFiles.delete(key);
    parent.variants = (parent.variants ?? []).filter((value) => value !== variant);
    this.syncVisual();
  }
  downloadImage(product: EditorialProduct, image: EditorialImage) {
    const url = this.preview(product, image);
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = image.file;
    link.click();
  }
  async generateVariants(product: EditorialProduct, image: EditorialImage) {
    const source = this.localFiles.get(`${product.slug}/${image.file}`);
    if (!source || this.busy() || image.variants?.length) return;
    this.changed();
    this.busy.set(true);
    const staged: { image: EditorialImage; blob: Blob }[] = [];
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(source);
      for (const width of [320, 640, 960].filter((width) => width < image.width)) {
        const height = Math.max(1, Math.round((image.height * width) / image.width));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error();
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(bitmap, 0, 0, width, height);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((value) => (value ? resolve(value) : reject(new Error())), 'image/png'),
        );
        if (blob.size > 250000) throw new Error();
        const sha256 = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
          (value) => value.toString(16).padStart(2, '0'),
        ).join('');
        const file = `${image.file.slice(0, -4)}-${width}.png`;
        if (
          (product.images ?? [])
            .flatMap((value) => [value, ...(value.variants ?? [])])
            .some((value) => value.file === file)
        )
          throw new Error();
        staged.push({
          blob,
          image: { file, sha256, alt: image.alt, width, height, authorized: false },
        });
      }
      image.variants = staged.map((value) => value.image);
      for (const entry of staged) {
        const key = `${product.slug}/${entry.image.file}`;
        this.localFiles.set(key, entry.blob);
        this.previews.set(key, URL.createObjectURL(entry.blob));
      }
      this.syncVisual();
      this.message.set(
        staged.length
          ? 'Variantes generadas. Revisa, confirma derechos y descarga cada PNG antes de aprobar.'
          : 'El original es menor o igual a 320 px; no se amplía artificialmente.',
      );
    } catch {
      this.message.set('No se generaron variantes: revisa el archivo, nombres o límite de 250 kB.');
    } finally {
      bitmap?.close();
      this.busy.set(false);
    }
  }
  async imageSelected(event: Event, product: EditorialProduct, parent?: EditorialImage) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy()) return;
    this.changed();
    this.busy.set(true);
    try {
      if (
        !/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.png$/.test(file.name) ||
        file.size > 250000 ||
        (parent ? (parent.variants?.length ?? 0) >= 3 : (product.images?.length ?? 0) >= 8) ||
        (product.images ?? [])
          .flatMap((image) => [image, ...(image.variants ?? [])])
          .some((image) => image.file === file.name)
      )
        throw new Error();
      const bytes = await file.arrayBuffer();
      const view = new DataView(bytes);
      if (
        bytes.byteLength < 24 ||
        view.getUint32(0) !== 0x89504e47 ||
        view.getUint32(4) !== 0x0d0a1a0a ||
        view.getUint32(12) !== 0x49484452
      )
        throw new Error();
      const width = view.getUint32(16),
        height = view.getUint32(20);
      if (!width || !height || width > 4096 || height > 4096) throw new Error();
      if (
        parent &&
        (width >= parent.width ||
          parent.variants?.some((value) => value.width === width) ||
          Math.abs(height / width - parent.height / parent.width) > 1 / width)
      )
        throw new Error();
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      const sha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        (value) => value.toString(16).padStart(2, '0'),
      ).join('');
      const image = { file: file.name, sha256, alt: '', width, height, authorized: false };
      if (parent) parent.variants = [...(parent.variants ?? []), image];
      else product.images = [...(product.images ?? []), image];
      this.localFiles.set(`${product.slug}/${image.file}`, file);
      this.previews.set(`${product.slug}/${image.file}`, URL.createObjectURL(file));
      this.syncVisual();
      this.message.set(
        'Imagen revisable agregada. Completa texto alternativo y confirma derechos. Copia el mismo archivo a media-approved antes de publicar.',
      );
    } catch {
      this.message.set(
        'PNG rechazado: archivo inválido, duplicado o fuera de límites (250 kB, 4096 × 4096, ocho por ficha).',
      );
    } finally {
      this.busy.set(false);
    }
  }
  visualReady() {
    return (
      !this.visualError() &&
      this.products().every((p) =>
        (p.images ?? [])
          .flatMap((image) => [image, ...(image.variants ?? [])])
          .every((i) => i.authorized === true && !!i.alt.trim()),
      )
    );
  }
  select(id: number) {
    if (this.busy()) return;
    const ids = this.ids.trim() ? this.ids.split(',').map((value) => Number(value.trim())) : [];
    if (ids.includes(id)) {
      this.message.set('El producto ya está seleccionado.');
      return;
    }
    if (ids.length >= 25) {
      this.message.set('El lote admite hasta 25 productos.');
      return;
    }
    this.ids = [...ids, id].join(', ');
    this.members.set([]);
    this.products.set([]);
    this.changed();
    this.message.set('Producto seleccionado. Prepara el lote para cargar las fichas.');
  }
  changed() {
    this.confirmed = false;
    this.status.set(null);
    this.revokeConfirmed = false;
  }
  prepare() {
    if (this.busy()) return;
    const ids = this.ids.split(',').map((value) => Number(value.trim()));
    if (
      !ids.length ||
      ids.length > 25 ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1) ||
      new Set(ids).size !== ids.length
    ) {
      this.message.set('Selecciona entre 1 y 25 IDs únicos de productos.');
      return;
    }
    this.changed();
    this.members.set([]);
    this.raw = '';
    this.products.set([]);
    this.clearPreviews();
    this.visualError.set('');
    this.busy.set(true);
    this.message.set('');
    forkJoin(
      ids.map((id) =>
        forkJoin({
          profile: this.http.get<{ ficha: { version: number } | null }>(`${this.url}/${id}`),
          candidate: this.http.get<{ products: Record<string, unknown>[] }>(
            `${this.url}/${id}/export-candidate`,
          ),
        }),
      ),
    )
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: (results) => {
          if (
            results.some(
              (result) => !result.profile.ficha || result.candidate.products.length !== 1,
            )
          ) {
            this.message.set('No se pudo preparar el lote completo.');
            return;
          }
          this.members.set(
            results.map((result, index) => ({
              productId: ids[index],
              version: result.profile.ficha!.version,
            })),
          );
          this.raw = JSON.stringify(
            {
              schemaVersion: 1,
              products: results.map((result) => ({
                ...result.candidate.products[0],
                status: 'published',
                approved: true,
              })),
            },
            null,
            2,
          );
          this.message.set(
            'Revisa todas las fichas y los medios antes de confirmar. Todavía no hay aprobación registrada.',
          );
          this.parseVisual();
        },
        error: () =>
          this.message.set(
            'No se pudo preparar el lote. Todas las fichas deben estar listas y confirmadas.',
          ),
      });
  }
  approve() {
    if (
      this.busy() ||
      !this.confirmed ||
      !this.members().length ||
      this.raw.length > 200000 ||
      !this.visualReady()
    )
      return;
    this.busy.set(true);
    this.message.set('');
    this.status.set(null);
    this.revokeConfirmed = false;
    this.http
      .post<{ raw: string; sha256: string; receipt: { id: number } }>(`${this.url}/batch/approve`, {
        raw: this.raw,
        members: this.members(),
        confirmed: true,
      })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: (result) => {
          this.receipt = String(result.receipt.id);
          this.confirmed = false;
          this.download(result.raw);
          this.message.set(
            `Lote aprobado. Recibo ${result.receipt.id}. SHA-256: ${result.sha256}. No se activó el sitio.`,
          );
        },
        error: () => {
          this.confirmed = false;
          this.message.set(
            'Lote rechazado: revisa el manifiesto o vuelve a preparar para cargar versiones actuales.',
          );
        },
      });
  }
  consult() {
    const id = Number(this.receipt);
    if (this.busy()) return;
    this.status.set(null);
    this.revokeConfirmed = false;
    if (!Number.isSafeInteger(id) || id < 1) {
      this.message.set('Introduce un recibo válido.');
      return;
    }
    this.busy.set(true);
    this.http
      .get<BatchStatus>(`${this.url}/batch/approvals/${id}`)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: (result) => {
          this.status.set(result);
          this.message.set('Vigencia consultada.');
        },
        error: () => this.message.set('No se pudo consultar el recibo de lote.'),
      });
  }
  revoke() {
    const current = this.status();
    if (
      this.busy() ||
      !current ||
      current.revoked ||
      !this.revokeConfirmed ||
      current.receiptId !== Number(this.receipt)
    )
      return;
    this.busy.set(true);
    this.http
      .post(`${this.url}/batch/approvals/${current.receiptId}/revoke`, { confirmed: true })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.busy.set(false)),
      )
      .subscribe({
        next: () => {
          this.status.set({ ...current, active: false, revoked: true });
          this.revokeConfirmed = false;
          this.message.set('Recibo revocado. Las versiones activas deben retirarse por separado.');
        },
        error: () => {
          this.changed();
          this.message.set('No se pudo revocar. Consulta otra vez el recibo.');
        },
      });
  }
  private download(raw: string) {
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'catalogo-lote-aprobado.json';
    link.click();
    URL.revokeObjectURL(url);
  }
}
