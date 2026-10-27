import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog,MatDialogModule } from '@angular/material/dialog';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { Cliente360, ClienteService } from '../../services/cliente.service';
import { ConfirmService } from '../../shared/confirm.service';
import { NotificationService } from '../../shared/notification.service';

@Component({
  selector: 'app-cliente-360',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatCardModule, MatCheckboxModule,
    MatFormFieldModule, MatIconModule, MatInputModule, MatProgressSpinnerModule, MatSelectModule, MatTabsModule,MatDialogModule],
  templateUrl: './cliente-360.component.html',
  styleUrl: './cliente-360.component.css',
})
export class Cliente360Component {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(ClienteService);
  private readonly fb = inject(FormBuilder);
  private readonly confirm = inject(ConfirmService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(MatDialog);
  readonly idCliente = Number(this.route.snapshot.paramMap.get('id'));
  readonly data = signal<Cliente360 | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly showContactForm = signal(false);
  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.maxLength(150)]],
    cargo: ['', Validators.maxLength(100)],
    telefono: ['', Validators.maxLength(30)],
    email: ['', Validators.email],
    canalPreferido: ['Telefono'],
    esPrincipal: [false],
    notas: ['', Validators.maxLength(500)],
  });

  constructor() { this.load(); }

  async preferenciasComerciales(){
    const {ConsentimientoComercialDialogComponent}=await import('../../crm/consentimiento-comercial-dialog.component');
    this.dialog.open(ConsentimientoComercialDialogComponent,{width:'820px',maxWidth:'96vw',disableClose:true,data:{idCliente:this.idCliente,razonSocial:this.data()?.cliente.razonSocial??'Cliente'}});
  }

  load() {
    this.loading.set(true);
    this.service.getCliente360(this.idCliente).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: result => this.data.set(result),
      error: () => this.notifications.show('No se pudo cargar la ficha Cliente 360.'),
    });
  }

  saveContact() {
    if (this.form.invalid || (!this.form.controls.telefono.value.trim() && !this.form.controls.email.value.trim())) {
      this.form.markAllAsTouched();
      this.notifications.show('Captura el nombre y al menos un teléfono o correo.');
      return;
    }
    this.saving.set(true);
    this.service.addContacto(this.idCliente, this.form.getRawValue()).pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => {
        this.form.reset({ nombre: '', cargo: '', telefono: '', email: '', canalPreferido: 'Telefono', esPrincipal: false, notas: '' });
        this.showContactForm.set(false);
        this.notifications.show('Contacto agregado.', 3500, 'info');
        this.load();
      },
      error: () => this.notifications.show('No se pudo agregar el contacto.'),
    });
  }

  deleteContact(idContacto: number) {
    this.confirm.ask({ title: 'Eliminar contacto', message: 'Se quitará este contacto de la ficha del cliente.', confirmLabel: 'Eliminar' })
      .subscribe(ok => {
        if (!ok) return;
        this.service.deleteContacto(this.idCliente, idContacto).subscribe({
          next: () => { this.notifications.show('Contacto eliminado.', 3500, 'info'); this.load(); },
          error: () => this.notifications.show('No se pudo eliminar el contacto.'),
        });
      });
  }
}
