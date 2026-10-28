// frontend/src/app/cliente/cliente-list/cliente-list.component.ts

import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import anime from 'animejs';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ClienteService } from '../../services/cliente.service';
import { Cliente } from '../cliente.interface';
import { ClienteDialogComponent } from '../cliente-dialog/cliente-dialog.component';
import { RemoteDirectory } from '../../shared/remote-directory';
import { localDate } from '../../shared/document-download';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfirmService } from '../../shared/confirm.service';
import { ClienteUnidadesDialogComponent } from '../cliente-unidades-dialog/cliente-unidades-dialog.component';

@Component({
  selector: 'app-cliente-list',
  standalone: true,
  imports: [
    CommonModule, MatTableModule, MatPaginatorModule, MatSortModule,
    MatFormFieldModule, MatInputModule, MatIconModule,
    MatButtonModule, MatDialogModule, MatSnackBarModule, MatTooltipModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './cliente-list.component.html',
  styleUrls: ['../../shared/list-page.css', './cliente-list.component.css']
})
export class ClienteListComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  
  // ¡CAMBIO! Volvemos a usar camelCase (minúsculas)
  displayedColumns: string[] = ['idCliente', 'rfc', 'razonSocial', 'codigoPostal', 'saldoAFavor', 'acciones'];
  readonly directory: RemoteDirectory<Cliente>;
  get dataSource() { return this.directory.dataSource; }
  get isLoading() { return this.directory.loading(); }
  get totalItems() { return this.directory.total(); }

  constructor(
    private clienteService: ClienteService,
    public dialog: MatDialog,
    private snackBar: MatSnackBar,
    private confirm: ConfirmService,
  ) {
    this.directory = new RemoteDirectory(query => this.clienteService.getPage(query), message => this.mostrarNotificacion(message));
  }

  ngOnInit(): void {
    this.directory.connectUrl(this.route, this.router);
    this.directory.start();
  }
  ngOnDestroy(): void { this.directory.dispose(); }
  cargarClientes(): void { this.directory.reload(); }
  applyFilter(event: Event): void {
    const input = event.target;
    if (input instanceof HTMLInputElement) this.directory.setTerm(input.value);
  }
  exportar(): void {
    this.directory.export(query => this.clienteService.exportCsv(query), 'clientes' + '_' + localDate() + '.csv');
  }
  abrirDialogo(cliente?: Cliente): void {
    const dialogRef = this.dialog.open(ClienteDialogComponent, {
      width: '600px',
      data: cliente ? {...cliente} : null 
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.cargarClientes();
      }
    });
  }

  administrarUnidades(cliente: Cliente): void {
    this.dialog.open(ClienteUnidadesDialogComponent, {
      width: '920px',
      maxWidth: '96vw',
      data: { idCliente: cliente.idCliente, razonSocial: cliente.razonSocial },
      disableClose: true,
    });
  }

  async administrarPortal(cliente:Cliente):Promise<void>{
    const {PortalAccessDialogComponent}=await import('../../portal/portal-access-dialog.component');
    this.dialog.open(PortalAccessDialogComponent,{width:'760px',maxWidth:'96vw',data:{idCliente:cliente.idCliente,razonSocial:cliente.razonSocial},disableClose:true});
  }

  async documentosPortal(cliente:Cliente):Promise<void>{
    const {PortalPublicationsDialogComponent}=await import('../../portal/portal-publications-dialog.component');
    this.dialog.open(PortalPublicationsDialogComponent,{width:'820px',maxWidth:'96vw',data:{idCliente:cliente.idCliente,razonSocial:cliente.razonSocial},disableClose:true});
  }

  verCliente360(cliente: Cliente): void {
    void this.router.navigate(['/cliente', cliente.idCliente]);
  }

  eliminarCliente(idCliente: number): void {
    this.confirm.ask({ title: 'Eliminar cliente', message: 'Se eliminará la ficha del cliente si no tiene operaciones que deban conservarse.', confirmLabel: 'Eliminar cliente' }).subscribe(confirmed => {
      if (!confirmed) return;
      this.clienteService.deleteCliente(idCliente).subscribe({
        next: () => {
          this.mostrarNotificacion('Cliente eliminado con éxito');
          this.cargarClientes();
        },
        error: (err) => {
          this.mostrarNotificacion('Error al eliminar cliente: ' + (err.error?.message || err.message));
        }
      });
    });
  }

  mostrarNotificacion(mensaje: string) {
    this.snackBar.open(mensaje, 'Cerrar', { duration: 3000 });
  }

  animarEntradaTabla() {
    anime({ targets: '.mat-mdc-row', translateY: [20, 0], opacity: [0, 1], delay: anime.stagger(50), duration: 400, easing: 'easeOutCubic' });
  }
}
