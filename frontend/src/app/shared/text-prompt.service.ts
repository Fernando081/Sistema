import { Component, Inject, Injectable, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { Observable } from 'rxjs';

export interface TextPromptData {
  title: string;
  message: string;
  label: string;
  confirmLabel?: string;
  maxLength?: number;
}

@Component({
  selector: 'app-text-prompt-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: ` <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.message }}</p>
      <mat-form-field appearance="outline" class="w-full">
        <mat-label>{{ data.label }}</mat-label>
        <textarea
          matInput
          rows="4"
          [formControl]="value"
          [maxlength]="data.maxLength || 1000"
        ></textarea>
        <mat-hint align="end">{{ value.value.length }}/{{ data.maxLength || 1000 }}</mat-hint>
        <mat-error>Este dato es obligatorio.</mat-error>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="ref.close(null)">Cancelar</button>
      <button mat-flat-button [disabled]="value.invalid" (click)="submit()">
        {{ data.confirmLabel || 'Guardar' }}
      </button>
    </mat-dialog-actions>`,
})
export class TextPromptDialogComponent {
  readonly value = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  constructor(
    readonly ref: MatDialogRef<TextPromptDialogComponent>,
    @Inject(MAT_DIALOG_DATA) readonly data: TextPromptData,
  ) {}
  submit() {
    if (this.value.valid) this.ref.close(this.value.value.trim());
  }
}

@Injectable({ providedIn: 'root' })
export class TextPromptService {
  private readonly dialog = inject(MatDialog);
  ask(data: TextPromptData): Observable<string | null> {
    return this.dialog
      .open(TextPromptDialogComponent, { width: '480px', maxWidth: '94vw', data })
      .afterClosed();
  }
}
