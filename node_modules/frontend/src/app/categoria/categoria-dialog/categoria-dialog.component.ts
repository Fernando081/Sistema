// frontend/src/app/categoria/categoria-dialog/categoria-dialog.component.ts (REEMPLAZAR)

import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CategoriaService } from '../../services/categoria.service';
import { Categoria } from '../categoria.interface';

@Component({
  selector: 'app-categoria-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatButtonModule
  ],
  templateUrl: './categoria-dialog.component.html',
})
export class CategoriaDialogComponent implements OnInit {
  form: FormGroup;
  isEditMode: boolean;

  constructor(
    private fb: FormBuilder,
    private categoriaService: CategoriaService,
    private dialogRef: MatDialogRef<CategoriaDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Categoria, // Recibe una Categoria
    private snackBar: MatSnackBar
  ) {
    this.isEditMode = !!data;
    
    this.form = this.fb.group({
      // Un solo campo
      descripcion: ['', [Validators.required, Validators.maxLength(100)]]
    });
  }

  ngOnInit(): void {
    if (this.isEditMode && this.data) {
      this.form.patchValue({ descripcion: this.data.descripcion });
    }
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched(); 
      return;
    }

    const descripcion = this.form.get('descripcion')?.value;
    let request;

    if (this.isEditMode) {
      request = this.categoriaService.updateCategoria(this.data.idCategoria, descripcion);
    } else {
      request = this.categoriaService.createCategoria(descripcion);
    }

    request.subscribe({
      next: () => {
        const message = this.isEditMode ? 'Categoría actualizada' : 'Categoría creada';
        this.mostrarNotificacion(message);
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.mostrarNotificacion('Error al guardar: ' + (err.error?.message || err.message));
      }
    });
  }

  cerrar(): void {
    this.dialogRef.close();
  }

  mostrarNotificacion(mensaje: string) {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 });
  }
}