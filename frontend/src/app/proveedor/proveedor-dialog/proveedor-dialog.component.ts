// frontend/src/app/proveedor/proveedor-dialog/proveedor-dialog.component.ts (REEMPLAZAR)
import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select'; // <--- Importante
import { Observable } from 'rxjs';

import { ProveedorService } from '../../services/proveedor.service';
import { Proveedor, CreateProveedorDto, UpdateProveedorDto } from '../proveedor.interface';
// Importamos el servicio de catálogos y las interfaces
import { CatalogosService, RegimenFiscal, UsoCFDI, FormaPago, MetodoPago, Estado, Municipio } from '../../services/catalogos.service';

@Component({
  selector: 'app-proveedor-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatSelectModule
  ],
  templateUrl: './proveedor-dialog.component.html',
})
export class ProveedorDialogComponent implements OnInit {
  form: FormGroup;
  isEditMode: boolean;

  // Observables para los catálogos simples
  regimenes$!: Observable<RegimenFiscal[]>;
  usosCFDI$!: Observable<UsoCFDI[]>;
  formasPago$!: Observable<FormaPago[]>;
  metodosPago$!: Observable<MetodoPago[]>;

  // Listas para la lógica de Estados/Municipios
  estados: Estado[] = [];
  municipios: Municipio[] = [];

  constructor(
    private fb: FormBuilder,
    private proveedorService: ProveedorService,
    private catalogosService: CatalogosService, // <--- Inyectamos el servicio
    private dialogRef: MatDialogRef<ProveedorDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Proveedor,
    private snackBar: MatSnackBar
  ) {
    this.isEditMode = !!data;
    
    this.form = this.fb.group({
      rfc: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(13)]],
      razonSocial: ['', [Validators.required, Validators.maxLength(255)]],
      pais: ['México', [Validators.maxLength(50)]],
      
      // Selects de Dirección
      idEstado: [null],
      idMunicipio: [null],
      
      ciudad: ['', [Validators.maxLength(50)]],
      colonia: ['', [Validators.maxLength(100)]],
      calle: ['', [Validators.maxLength(100)]],
      codigoPostal: ['', [Validators.required, Validators.maxLength(5), Validators.pattern('^[0-9]{5}$')]],
      numeroExterior: ['', [Validators.maxLength(20)]],
      numeroInterior: ['', [Validators.maxLength(20)]],
      referencia: ['', [Validators.maxLength(100)]],
      
      // Selects del SAT
      idMetodoDePago: [null],
      idUsoCFDI: [null],
      idFormaPago: [null],
      idRegimenFiscal: [null, Validators.required]
    });
  }

  ngOnInit(): void {
    // 1. Cargar catálogos del SAT
    this.regimenes$ = this.catalogosService.getRegimenesFiscales();
    this.usosCFDI$ = this.catalogosService.getUsosCFDI();
    this.formasPago$ = this.catalogosService.getFormasPago();
    this.metodosPago$ = this.catalogosService.getMetodosPago();

    // --- LÓGICA DE BLOQUEO CORRECTA (Para evitar error de Angular) ---
    const municipioControl = this.form.get('idMunicipio');
    
    if (!this.isEditMode) {
      municipioControl?.disable(); // Bloqueamos al inicio si es nuevo
    }

    // 2. Cargar Estados
    this.catalogosService.getEstados().subscribe(estados => {
      this.estados = estados;
      
      // Si estamos editando y el proveedor ya tiene estado, cargamos sus municipios
      if (this.isEditMode && this.data.idEstado) {
        this.cargarMunicipios(this.data.idEstado);
        municipioControl?.enable(); // Habilitamos porque ya hay datos
      }
    });

    // 3. Detectar cambios en el Estado (Efecto Cascada)
    this.form.get('idEstado')?.valueChanges.subscribe(idEstado => {
      if (idEstado) {
        municipioControl?.enable(); // Desbloquear
        this.cargarMunicipios(idEstado);
      } else {
        this.municipios = [];
        municipioControl?.setValue(null);
        municipioControl?.disable(); // Bloquear si quita el estado
      }
    });

    if (this.isEditMode && this.data) {
      this.form.patchValue(this.data);
    }
  }

  cargarMunicipios(idEstado: number) {
    const estadoSeleccionado = this.estados.find(e => e.idEstado === idEstado);
    
    if (estadoSeleccionado) {
      this.catalogosService.getMunicipiosPorEstado(estadoSeleccionado.clave)
        .subscribe(municipios => {
          this.municipios = municipios;
        });
    }
  }

  guardar(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched(); 
      return;
    }

    const formData = this.form.getRawValue(); // getRawValue() incluye campos deshabilitados si los hubiera
    let request;

    if (this.isEditMode) {
      const updateData: UpdateProveedorDto = formData;
      request = this.proveedorService.updateProveedor(this.data.idProveedor, updateData);
    } else {
      const createData: CreateProveedorDto = formData;
      request = this.proveedorService.createProveedor(createData);
    }

    request.subscribe({
      next: () => {
        const message = this.isEditMode ? 'Proveedor actualizado con éxito' : 'Proveedor creado con éxito';
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