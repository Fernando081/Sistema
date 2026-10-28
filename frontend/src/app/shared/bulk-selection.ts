import { computed, signal } from '@angular/core';

/**
 * U02.3 · Selección múltiple de un listado paginado. Se conserva al cambiar de página para armar lotes
 * de varias páginas; guarda la fila para que la acción conozca sus datos sin volver a consultarlos.
 */
export class BulkSelection<Row, Id extends string | number = number> {
  private readonly selected = signal(new Map<Id, Row>());
  readonly count = computed(() => this.selected().size);
  readonly rows = computed(() => [...this.selected().values()]);
  readonly ids = computed(() => [...this.selected().keys()]);

  constructor(
    private readonly idOf: (row: Row) => Id,
    readonly max: number,
    private readonly selectable: (row: Row) => boolean = () => true,
  ) {}

  isSelected(row: Row): boolean {
    return this.selected().has(this.idOf(row));
  }
  canSelect(row: Row): boolean {
    return this.selectable(row);
  }

  /** Devuelve false si se alcanzó el máximo y la fila no se agregó. */
  toggle(row: Row): boolean {
    const id = this.idOf(row);
    const next = new Map(this.selected());
    if (next.has(id)) next.delete(id);
    else if (!this.selectable(row) || next.size >= this.max) return false;
    else next.set(id, row);
    this.selected.set(next);
    return true;
  }

  allSelected(page: Row[]): boolean {
    const candidates = page.filter(this.selectable);
    return candidates.length > 0 && candidates.every((row) => this.isSelected(row));
  }

  someSelected(page: Row[]): boolean {
    return page.some((row) => this.isSelected(row)) && !this.allSelected(page);
  }

  /** Marca o desmarca las filas seleccionables de la página visible, respetando el máximo. */
  togglePage(page: Row[]): void {
    const next = new Map(this.selected());
    const candidates = page.filter(this.selectable);
    if (this.allSelected(page)) candidates.forEach((row) => next.delete(this.idOf(row)));
    else
      for (const row of candidates) {
        if (next.size >= this.max) break;
        next.set(this.idOf(row), row);
      }
    this.selected.set(next);
  }

  clear(): void {
    this.selected.set(new Map());
  }
}
