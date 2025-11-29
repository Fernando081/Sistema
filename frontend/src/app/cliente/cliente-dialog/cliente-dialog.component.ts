// frontend/src/app/cliente/cliente-dialog/cliente-dialog.component.ts
import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { CommonModule } from '@angular/common';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select'; // Importante
import { Observable } from 'rxjs';

import { ClienteService } from '../../services/cliente.service';
import { Cliente, CreateClienteDto, UpdateClienteDto } from '../cliente.interface';
// Importamos el servicio y las interfaces
import { CatalogosService, RegimenFiscal, UsoCFDI, FormaPago, MetodoPago, Estado, Municipio } from '../../services/catalogos.service';

@Component({
  selector: 'app-cliente-dialog',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatDialogModule, MatFormFieldModule,
    MatInputModule, MatButtonModule, MatSelectModule // <--- No olvides esto
  ],
  templateUrl: './cliente-dialog.component.html',
})
export class ClienteDialogComponent implements OnInit {
  form: FormGroup;
  isEditMode: boolean;

  // Listas para Dropdowns
  regimenes$!: Observable<RegimenFiscal[]>;
  usosCFDI$!: Observable<UsoCFDI[]>;
  formasPago$!: Observable<FormaPago[]>;
  metodosPago$!: Observable<MetodoPago[]>;
  
  
  // Lógica de Estado/Municipio
  estados: Estado[] = []; // Guardamos la lista completa para buscar claves
  municipios: Municipio[] = []; // Esta lista cambiará según el estado

  constructor(
    private fb: FormBuilder,
    private clienteService: ClienteService,
    private catalogosService: CatalogosService, // <--- Inyectar
    private dialogRef: MatDialogRef<ClienteDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: Cliente,
    private snackBar: MatSnackBar
  ) {
    this.isEditMode = !!data;
    
    this.form = this.fb.group({
      rfc: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(13)]],
      razonSocial: ['', [Validators.required, Validators.maxLength(255)]],
      pais: ['México', [Validators.maxLength(50)]],
      
      // Selects
      idEstado: [null],
      idMunicipio: [null],
      
      ciudad: ['', [Validators.maxLength(50)]],
      colonia: ['', [Validators.maxLength(100)]],
      calle: ['', [Validators.maxLength(100)]],
      codigoPostal: ['', [Validators.required, Validators.maxLength(5), Validators.pattern('^[0-9]{5}$')]],
      numeroExterior: ['', [Validators.maxLength(20)]],
      numeroInterior: ['', [Validators.maxLength(20)]],
      referencia: ['', [Validators.maxLength(100)]],
      
      // Selects SAT
      idMetodoDePago: [null],
      idUsoCFDI: [null],
      idFormaPago: [null],
      idRegimenFiscal: [null, Validators.required],
      email: ['', [Validators.email]],
    });
  }

  ngOnInit(): void {
    // 1. Cargar catálogos simples
    this.regimenes$ = this.catalogosService.getRegimenesFiscales();
    this.usosCFDI$ = this.catalogosService.getUsosCFDI();
    this.formasPago$ = this.catalogosService.getFormasPago();
    this.metodosPago$ = this.catalogosService.getMetodosPago();

    // --- CORRECCIÓN INICIO: Bloquear Municipio al inicio si no hay datos ---
    const municipioControl = this.form.get('idMunicipio');
    
    // Si es modo "Nuevo", bloqueamos municipio de inicio
    if (!this.isEditMode) {
      municipioControl?.disable();
    }
    // --- CORRECCIÓN FIN ---

    // 2. Cargar Estados
    this.catalogosService.getEstados().subscribe(estados => {
      this.estados = estados;
      
      if (this.isEditMode && this.data.idEstado) {
        this.cargarMunicipios(this.data.idEstado);
        municipioControl?.enable(); // Habilitar si estamos editando y hay estado
      }
    });

    // 3. Escuchar cambios en el Estado (Efecto Cascada)
    this.form.get('idEstado')?.valueChanges.subscribe(idEstado => {
      if (idEstado) {
        // Si seleccionó estado: Desbloquear y cargar
        municipioControl?.enable();
        this.cargarMunicipios(idEstado);
      } else {
        // Si borró el estado: Limpiar lista, bloquear y borrar selección
        this.municipios = [];
        municipioControl?.disable();
        municipioControl?.setValue(null);
      }
    });

    if (this.isEditMode && this.data) {
      this.form.patchValue(this.data);
    }
  }

  cargarMunicipios(idEstado: number) {
    // Buscar el estado en nuestra lista local para obtener su CLAVE (ej. 'TAM')
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
    const formData = this.form.getRawValue();
    let request;

    if (this.isEditMode) {
      request = this.clienteService.updateCliente(this.data.idCliente, formData);
    } else {
      request = this.clienteService.createCliente(formData);
    }

    request.subscribe({
      next: () => {
        const message = this.isEditMode ? 'Cliente actualizado' : 'Cliente creado';
        this.mostrarNotificacion(message);
        this.dialogRef.close(true);
      },
      error: (err) => this.mostrarNotificacion('Error: ' + (err.error?.message || err.message))
    });
  }

  cerrar(): void { this.dialogRef.close(); }
  mostrarNotificacion(mensaje: string) { this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 }); }
}