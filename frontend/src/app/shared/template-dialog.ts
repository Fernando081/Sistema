// frontend/src/app/shared/template-dialog.ts
// U01.2 · Abre una plantilla del componente como MatDialog mientras `isOpen()` sea verdadero.
// La señal del componente sigue siendo la fuente de verdad: cerrar con Esc o con el fondo
// llama a `onDismiss` para que el componente limpie su estado. Debe llamarse en contexto de inyección.
import { effect, inject, Injector, Signal, TemplateRef, untracked } from '@angular/core';
import { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';

export function bindTemplateDialog(
  isOpen: () => boolean,
  template: Signal<TemplateRef<unknown> | undefined>,
  onDismiss: () => void,
  config: MatDialogConfig = {},
): void {
  const dialog = inject(MatDialog);
  const injector = inject(Injector);
  let ref: MatDialogRef<unknown> | null = null;
  effect(() => {
    const open = isOpen();
    const tpl = template();
    untracked(() => {
      if (open && !ref && tpl) {
        ref = dialog.open(tpl, {
          width: 'min(720px, 96vw)',
          maxHeight: '90vh',
          autoFocus: 'first-tabbable',
          restoreFocus: true,
          injector,
          ...config,
        });
        ref.afterClosed().subscribe(() => {
          ref = null;
          if (isOpen()) onDismiss();
        });
      } else if (!open && ref) {
        ref.close();
      }
    });
  });
}
