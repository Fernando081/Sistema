import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { forkJoin } from 'rxjs';
import { AjusteProveedores, BalanceGeneral, BalanzaCuenta, DpoContable, CandidatoConciliacion, CentroCosto, CierreTesoreria, ConciliacionTesoreria, CuentaContable, CuentaTesoreria, EstadoResultados, FinanzasService, FlujoEfectivo, ImportacionTesoreria, MovimientoTesoreria, PeriodoContable, PolizaContable, PresupuestoContable } from '../finanzas.service';
import { NotificationService } from '../../shared/notification.service';
import { ConfirmService } from '../../shared/confirm.service';
import { downloadDocument } from '../../shared/document-download';

const localIsoDate = (date = new Date()) => {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

@Component({
  selector: 'app-contabilidad',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, MatButtonModule, MatCardModule, MatFormFieldModule,
    MatIconModule, MatInputModule, MatSelectModule, MatTabsModule],
  templateUrl: './contabilidad.component.html',
  styleUrls: ['./contabilidad.component.css', './tesoreria.component.css', './control-financiero.component.css'],
})
export class ContabilidadComponent {
  private readonly api = inject(FinanzasService);
  private readonly fb = inject(FormBuilder);
  private readonly notice = inject(NotificationService);
  private readonly confirm = inject(ConfirmService);
  readonly loading = signal(false);
  readonly cuentas = signal<CuentaContable[]>([]);
  readonly polizas = signal<PolizaContable[]>([]);
  readonly balanza = signal<BalanzaCuenta[]>([]);
  readonly resultados = signal<EstadoResultados | null>(null);
  readonly balance = signal<BalanceGeneral | null>(null);
  readonly dpo = signal<DpoContable | null>(null);
  readonly ajusteProveedores = signal<AjusteProveedores | null>(null);
  readonly creandoAjuste = signal(false);
  readonly totalPolizas = signal(0);
  readonly cuentasTesoreria = signal<CuentaTesoreria[]>([]);
  readonly movimientosTesoreria = signal<MovimientoTesoreria[]>([]);
  readonly candidatos = signal<CandidatoConciliacion[]>([]);
  readonly movimientoSeleccionado = signal<MovimientoTesoreria | null>(null);
  readonly movimientosBancoSeleccionados = signal<number[]>([]);
  readonly movimientosSistemaSeleccionados = signal<number[]>([]);
  readonly transferenciasCandidatas = signal<MovimientoTesoreria[]>([]);
  readonly importacionesTesoreria = signal<ImportacionTesoreria[]>([]);
  readonly conciliacionesTesoreria = signal<ConciliacionTesoreria[]>([]);
  readonly cierresTesoreria = signal<CierreTesoreria[]>([]);
  readonly importandoBanco = signal(false);
  readonly ultimoResultadoImportacion = signal<{insertados:number;duplicados:number;conciliadosAuto:number;errores:number}|null>(null);
  readonly bankEditorOpen = signal(false);
  readonly periodos = signal<PeriodoContable[]>([]);
  readonly centrosCosto = signal<CentroCosto[]>([]);
  readonly presupuestos = signal<PresupuestoContable[]>([]);
  readonly flujo = signal<FlujoEfectivo | null>(null);
  readonly editorOpen = signal(false);
  readonly formVersion = signal(0);
  readonly hoy = localIsoDate();
  readonly inicioAnio = `${new Date().getFullYear()}-01-01`;

  readonly filtros = this.fb.nonNullable.group({ fechaInicio: this.inicioAnio, fechaFin: this.hoy });
  readonly ajusteProveedoresForm = this.fb.nonNullable.group({ fecha: this.hoy, idCuenta: [0, Validators.min(1)], motivo: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(200)]], revisado: false });
  readonly cuentasContrapartida = computed(() => this.cuentas().filter((c) => c.codigo !== '2100'));
  readonly polizaForm = this.fb.nonNullable.group({
    fecha: [this.hoy, Validators.required], tipo: ['Diario', Validators.required],
    concepto: ['', [Validators.required, Validators.maxLength(300)]],
    partidas: this.fb.array([this.createLine(), this.createLine()]),
  });
  readonly cuentaForm = this.fb.nonNullable.group({ nombre:['',Validators.required],banco:['',Validators.required],moneda:['MXN',Validators.required],ultimosCuatro:['',Validators.pattern(/^\d{4}$/)],saldoInicial:[0] });
  readonly movimientoForm = this.fb.nonNullable.group({ idCuenta:[0,Validators.min(1)],fecha:[this.hoy,Validators.required],descripcion:['',Validators.required],referencia:'',monto:[0] });
  readonly importacionForm = this.fb.nonNullable.group({idCuenta:[0,Validators.min(1)],autoConciliar:true});
  readonly ajusteForm = this.fb.nonNullable.group({tipoAjuste:'',motivo:''});
  readonly cierreTesoreriaForm = this.fb.nonNullable.group({idCuenta:[0,Validators.min(1)],anio:[new Date().getFullYear()],mes:[new Date().getMonth()+1],saldoEstadoCuenta:[0]});
  bankFile?:File;
  readonly periodoForm = this.fb.nonNullable.group({anio:[new Date().getFullYear(),[Validators.min(2000),Validators.max(2200)]],mes:[new Date().getMonth()+1,[Validators.min(1),Validators.max(12)]]});
  readonly presupuestoForm = this.fb.nonNullable.group({anio:[new Date().getFullYear()],mes:[new Date().getMonth()+1],idCuenta:[0,Validators.min(1)],idCentroCosto:[0],monto:[0,Validators.min(0)],notas:''});

  readonly totalDebe = computed(() => {
    this.formVersion();
    return this.money(this.partidas.controls.reduce((sum, row) => sum + Number(row.controls.debe.value || 0), 0));
  });
  readonly totalHaber = computed(() => {
    this.formVersion();
    return this.money(this.partidas.controls.reduce((sum, row) => sum + Number(row.controls.haber.value || 0), 0));
  });
  readonly cuadrada = computed(() => this.totalDebe() > 0 && this.totalDebe() === this.totalHaber());
  readonly movimientosBancoDisponibles = computed(()=>{
    const selected=this.movimientoSeleccionado();
    return selected ? this.movimientosTesoreria().filter(row=>row.estado==='Pendiente'&&row.idCuenta===selected.idCuenta) : [];
  });
  readonly totalBancoSeleccionado = computed(()=>this.money(this.movimientosTesoreria().filter(row=>this.movimientosBancoSeleccionados().includes(row.idMovimiento)).reduce((sum,row)=>sum+Number(row.monto),0)));
  readonly totalSistemaSeleccionado = computed(()=>this.money(this.candidatos().filter(row=>this.movimientosSistemaSeleccionados().includes(row.idCajaMovimiento)).reduce((sum,row)=>sum+Number(row.monto),0)));
  readonly diferenciaConciliacion = computed(()=>this.money(this.totalBancoSeleccionado()-this.totalSistemaSeleccionado()));

  constructor() {
    this.polizaForm.valueChanges.subscribe(() => this.formVersion.update(value => value + 1));
    this.load();
  }

  get partidas() { return this.polizaForm.controls.partidas; }

  createLine() {
    return this.fb.nonNullable.group({ idCuenta: [0, Validators.min(1)], idCentroCosto:[0], concepto: '', referencia: '', debe: [0, Validators.min(0)], haber: [0, Validators.min(0)] });
  }

  // F02a · Se consulta aparte para no bloquear la contabilidad si falla.
  loadAjusteProveedores() { this.api.getAjusteProveedores().subscribe({ next: (a) => this.ajusteProveedores.set(a && Array.isArray(a.compras) && Array.isArray(a.ajustes) ? a : null), error: () => this.ajusteProveedores.set(null) }); }

  crearAjusteProveedores() {
    const a = this.ajusteProveedores();
    const v = this.ajusteProveedoresForm.getRawValue();
    if (!a?.compras.length || this.ajusteProveedoresForm.invalid || !v.revisado || this.creandoAjuste()) return;
    const cuenta = this.cuentas().find((c) => c.idCuenta === v.idCuenta);
    this.confirm.ask({ title: 'Crear póliza de ajuste en borrador', message: `Se cargarán ${a.total.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} a Proveedores (2100) por ${a.compras.length} compras y se abonará a ${cuenta?.codigo} ${cuenta?.nombre}. La póliza queda en borrador: no cambia saldos hasta que se contabilice.`, confirmLabel: 'Crear borrador' }).subscribe((ok) => {
      if (!ok) return;
      this.creandoAjuste.set(true);
      this.api.crearAjusteProveedores({ fecha: v.fecha, idCuentaContrapartida: v.idCuenta, motivo: v.motivo.trim(), compras: a.compras.map((c) => c.idCompra), confirmacion: true }).subscribe({
        next: (r) => { this.creandoAjuste.set(false); this.ajusteProveedoresForm.patchValue({ motivo: '', revisado: false }); this.notice.show(`Póliza ${r.folio} creada en borrador. Revísala con tu contador en Pólizas antes de contabilizarla.`, 6000, 'info'); this.load(); },
        error: (e: { error?: { message?: string } }) => { this.creandoAjuste.set(false); this.notice.show(e.error?.message ?? 'No se pudo crear la póliza de ajuste.'); this.loadAjusteProveedores(); },
      });
    });
  }

  addLine() { this.partidas.push(this.createLine()); }
  removeLine(index: number) { if (this.partidas.length > 2) this.partidas.removeAt(index); }

  load() {
    const { fechaInicio, fechaFin } = this.filtros.getRawValue();
    if (fechaInicio > fechaFin) return this.notice.show('La fecha inicial debe ser anterior a la final.');
    this.loading.set(true);
    forkJoin({
      cuentas: this.api.getCuentasContables(), polizas: this.api.getPolizas(fechaInicio, fechaFin),
      balanza: this.api.getBalanza(fechaInicio, fechaFin), resultados: this.api.getEstadoResultados(fechaInicio, fechaFin),
      balance: this.api.getBalanceGeneral(fechaFin),
      dpo: this.api.getDpoContable(fechaInicio, fechaFin),
      cuentasTesoreria: this.api.getCuentasTesoreria(), movimientosTesoreria: this.api.getMovimientosTesoreria(),importacionesTesoreria:this.api.getImportacionesTesoreria(),
      conciliacionesTesoreria:this.api.getConciliacionesTesoreria(),cierresTesoreria:this.api.getCierresTesoreria(),
      periodos:this.api.getPeriodos(),centrosCosto:this.api.getCentrosCosto(),
      presupuestos:this.api.getPresupuestos(Number(fechaFin.slice(0,4)),Number(fechaFin.slice(5,7))),
      flujo:this.api.getFlujoEfectivo(fechaInicio,fechaFin),
    }).subscribe({
      next: data => {
        this.cuentas.set(data.cuentas.filter(c => c.activa && c.aceptaMovimientos));
        this.polizas.set(data.polizas.data); this.totalPolizas.set(data.polizas.total);
        this.balanza.set(data.balanza); this.resultados.set(data.resultados); this.balance.set(data.balance); this.dpo.set(data.dpo);
        this.cuentasTesoreria.set(data.cuentasTesoreria); this.movimientosTesoreria.set(data.movimientosTesoreria);this.importacionesTesoreria.set(data.importacionesTesoreria);
        this.conciliacionesTesoreria.set(data.conciliacionesTesoreria);this.cierresTesoreria.set(data.cierresTesoreria);
        if(data.cuentasTesoreria.length){const id=data.cuentasTesoreria[0].idCuenta;if(!this.movimientoForm.controls.idCuenta.value)this.movimientoForm.controls.idCuenta.setValue(id);if(!this.importacionForm.controls.idCuenta.value)this.importacionForm.controls.idCuenta.setValue(id);if(!this.cierreTesoreriaForm.controls.idCuenta.value)this.cierreTesoreriaForm.controls.idCuenta.setValue(id)}
        this.periodos.set(data.periodos);this.centrosCosto.set(data.centrosCosto.filter(c=>c.activo));
        this.presupuestos.set(data.presupuestos);this.flujo.set(data.flujo);
        this.loading.set(false);
        this.loadAjusteProveedores();
      },
      error: () => { this.loading.set(false); this.notice.show('No se pudo cargar la contabilidad.'); },
    });
  }

  saveDraft() {
    if (this.polizaForm.invalid || !this.cuadrada()) return this.notice.show('Completa la póliza y asegúrate de que cargos y abonos sean iguales.');
    const payload = this.polizaForm.getRawValue();
    if (payload.partidas.some(line => (line.debe > 0) === (line.haber > 0))) return this.notice.show('Cada partida debe tener cargo o abono, pero no ambos.');
    this.loading.set(true);
    this.api.crearPoliza(payload).subscribe({
      next: () => { this.notice.show('Póliza guardada como borrador.', 3500, 'info'); this.resetEditor(); this.load(); },
      error: () => { this.loading.set(false); this.notice.show('No se pudo guardar la póliza.'); },
    });
  }

  post(poliza: PolizaContable) {
    this.api.contabilizarPoliza(poliza.idPoliza).subscribe({
      next: () => { this.notice.show('Póliza contabilizada.', 3500, 'info'); this.load(); },
      error: () => this.notice.show('No se pudo contabilizar la póliza.'),
    });
  }

  saveBankAccount() {
    if (this.cuentaForm.invalid) return this.notice.show('Completa los datos de la cuenta.');
    const raw=this.cuentaForm.getRawValue();
    this.api.crearCuentaTesoreria({...raw,ultimosCuatro:raw.ultimosCuatro||undefined}).subscribe({next:()=>{this.notice.show('Cuenta bancaria creada.',3500,'info');this.cuentaForm.reset({nombre:'',banco:'',moneda:'MXN',ultimosCuatro:'',saldoInicial:0});this.bankEditorOpen.set(false);this.load()},error:()=>this.notice.show('No se pudo crear la cuenta bancaria.')});
  }

  saveBankMovement() {
    const raw=this.movimientoForm.getRawValue();
    if(this.movimientoForm.invalid || Number(raw.monto)===0) return this.notice.show('Completa el movimiento con un monto distinto de cero.');
    this.api.crearMovimientoTesoreria({...raw,referencia:raw.referencia||undefined}).subscribe({next:()=>{this.notice.show('Movimiento importado.',3500,'info');this.movimientoForm.reset({idCuenta:raw.idCuenta,fecha:this.hoy,descripcion:'',referencia:'',monto:0});this.load()},error:()=>this.notice.show('No se pudo importar el movimiento; revisa la referencia.')});
  }

  selectBankFile(event:Event){const file=(event.target as HTMLInputElement).files?.[0];this.bankFile=undefined;if(!file)return;if(file.size>5*1024*1024)return this.notice.show('El CSV no puede superar 5 MB.');this.bankFile=file}

  importBankStatement(){
    if(this.importacionForm.invalid||!this.bankFile)return this.notice.show('Selecciona la cuenta y el archivo CSV.');
    const raw=this.importacionForm.getRawValue();this.importandoBanco.set(true);
    this.api.importarEstadoCuenta(raw.idCuenta,this.bankFile,raw.autoConciliar).subscribe({next:r=>{this.importandoBanco.set(false);this.ultimoResultadoImportacion.set({insertados:r.insertados,duplicados:r.duplicados,conciliadosAuto:r.conciliadosAuto,errores:r.errores.length});this.notice.show(r.repeated?'Ese archivo ya había sido importado.':`Importación terminada: ${r.insertados} movimientos, ${r.conciliadosAuto} conciliados.`,5000,'info');this.bankFile=undefined;this.load()},error:e=>{this.importandoBanco.set(false);this.notice.show(e.error?.message||'No se pudo importar el estado de cuenta.')}})
  }

  findMatches(movement: MovimientoTesoreria) {
    this.movimientoSeleccionado.set(movement);this.movimientosBancoSeleccionados.set([movement.idMovimiento]);
    this.movimientosSistemaSeleccionados.set([]);this.candidatos.set([]);this.transferenciasCandidatas.set([]);
    forkJoin({matches:this.api.getCandidatosConciliacion(movement.idMovimiento),transfers:this.api.getTransferenciasCandidatas(movement.idMovimiento)}).subscribe({next:result=>{
      this.candidatos.set(result.matches);this.transferenciasCandidatas.set(result.transfers);
      const exact=result.matches.find(row=>Number(row.diferencia)===0);if(exact)this.movimientosSistemaSeleccionados.set([exact.idCajaMovimiento]);
    },error:()=>this.notice.show('No se pudieron buscar coincidencias.')});
  }

  toggleBankMovement(id:number){this.movimientosBancoSeleccionados.update(rows=>rows.includes(id)?rows.filter(value=>value!==id):[...rows,id])}
  toggleSystemMovement(id:number){this.movimientosSistemaSeleccionados.update(rows=>rows.includes(id)?rows.filter(value=>value!==id):[...rows,id])}

  reconcileSelection() {
    if(!this.movimientosBancoSeleccionados().length||!this.movimientosSistemaSeleccionados().length)return this.notice.show('Selecciona movimientos del banco y del sistema.');
    const difference=this.diferenciaConciliacion();const adjustment=this.ajusteForm.getRawValue();
    if(difference!==0&&(!adjustment.tipoAjuste||!adjustment.motivo.trim()))return this.notice.show('Clasifica y explica la diferencia antes de conciliar.');
    this.api.crearConciliacionTesoreria({movimientosBanco:this.movimientosBancoSeleccionados(),movimientosSistema:this.movimientosSistemaSeleccionados(),
      tipoAjuste:difference!==0?adjustment.tipoAjuste:undefined,motivo:difference!==0?adjustment.motivo.trim():undefined}).subscribe({next:()=>{
      this.notice.show(difference===0?'Conciliación registrada.':'Conciliación y ajuste contable registrados.',4500,'info');this.closeMatching();this.load();
    },error:e=>this.notice.show(e.error?.message||'No se pudo registrar la conciliación.')});
  }

  reconcileTransfer(candidate:MovimientoTesoreria){const source=this.movimientoSeleccionado();if(!source)return;
    const output=Number(source.monto)<0?source:candidate;const input=Number(source.monto)>0?source:candidate;
    this.api.crearTransferenciaTesoreria(output.idMovimiento,input.idMovimiento,source.referencia||candidate.referencia||undefined).subscribe({next:()=>{
      this.notice.show('Traspaso entre cuentas conciliado.',4000,'info');this.closeMatching();this.load();
    },error:e=>this.notice.show(e.error?.message||'No se pudo conciliar el traspaso.')})}

  closeMatching(){this.movimientoSeleccionado.set(null);this.candidatos.set([]);this.transferenciasCandidatas.set([]);this.movimientosBancoSeleccionados.set([]);this.movimientosSistemaSeleccionados.set([]);this.ajusteForm.reset({tipoAjuste:'',motivo:''})}

  undoReconciliation(movement:MovimientoTesoreria){this.confirm.ask({title:'Revertir conciliación',message:'El movimiento volverá a pendientes y la coincidencia del sistema quedará disponible.',confirmLabel:'Revertir',tone:'danger'}).subscribe(ok=>{if(!ok)return;this.api.desconciliarMovimiento(movement.idMovimiento,'Corrección solicitada desde tesorería').subscribe({next:()=>{this.notice.show('Conciliación revertida.');this.load()},error:()=>this.notice.show('No se pudo revertir la conciliación.')})})}

  ignoreBankMovement(movement:MovimientoTesoreria){this.confirm.ask({title:'Ignorar movimiento',message:'Úsalo sólo para renglones informativos del banco que no corresponden a un movimiento contable.',confirmLabel:'Marcar como ignorado'}).subscribe(ok=>{if(!ok)return;this.api.ignorarMovimiento(movement.idMovimiento,'Movimiento informativo revisado por tesorería').subscribe({next:()=>{this.notice.show('Movimiento revisado e ignorado.');this.load()},error:()=>this.notice.show('No se pudo actualizar el movimiento.')})})}

  closeTreasuryMonth(){if(this.cierreTesoreriaForm.invalid)return this.notice.show('Completa los datos del cierre.');const raw=this.cierreTesoreriaForm.getRawValue();
    this.confirm.ask({title:'Cerrar mes de tesorería',message:'El saldo debe coincidir con el estado de cuenta. Después del cierre no se podrán alterar movimientos de ese mes ni de meses anteriores.',confirmLabel:'Verificar y cerrar',tone:'danger'}).subscribe(ok=>{
      if(!ok)return;this.api.cerrarTesoreria(raw).subscribe({next:()=>{this.notice.show('Mes de tesorería cerrado y protegido.',4500,'info');this.load()},error:e=>this.notice.show(e.error?.message||'No se pudo cerrar el mes.')})
    })}

  createPeriod() {
    if(this.periodoForm.invalid)return;
    const {anio,mes}=this.periodoForm.getRawValue();
    this.api.crearPeriodo(anio,mes).subscribe({next:()=>{this.notice.show('Periodo contable disponible.',3500,'info');this.load()},error:()=>this.notice.show('No se pudo crear el periodo.')});
  }

  closePeriod(period:PeriodoContable) {
    this.confirm.ask({title:'Cerrar periodo contable',message:`Después del cierre no se podrán registrar ni modificar pólizas de ${String(period.mes).padStart(2,'0')}/${period.anio}.`,confirmLabel:'Cerrar periodo',tone:'danger'}).subscribe(ok=>{
      if(!ok)return;this.api.cerrarPeriodo(period.idPeriodo).subscribe({next:()=>{this.notice.show('Periodo cerrado.',3500,'info');this.load()},error:()=>this.notice.show('No se pudo cerrar. Revisa si existen pólizas en borrador.')});
    });
  }

  saveBudget() {
    if(this.presupuestoForm.invalid)return this.notice.show('Completa el presupuesto.');
    const raw=this.presupuestoForm.getRawValue();
    this.api.guardarPresupuesto({...raw,idCentroCosto:raw.idCentroCosto||undefined,notas:raw.notas||undefined}).subscribe({next:()=>{this.notice.show('Presupuesto actualizado.',3500,'info');this.load()},error:()=>this.notice.show('No se pudo guardar el presupuesto.')});
  }

  exportReport(reporte:'balanza'|'resultados'|'balance'|'flujo') {
    const {fechaInicio,fechaFin}=this.filtros.getRawValue();
    this.api.exportarContabilidad(reporte,fechaInicio,fechaFin).subscribe({next:blob=>downloadDocument(blob,`${reporte}_${fechaInicio}_${fechaFin}.csv`),error:()=>this.notice.show('No se pudo exportar el reporte.')});
  }

  resetEditor() {
    this.editorOpen.set(false);
    this.polizaForm.controls.fecha.setValue(this.hoy); this.polizaForm.controls.tipo.setValue('Diario');
    this.polizaForm.controls.concepto.setValue(''); this.partidas.clear(); this.addLine(); this.addLine();
  }

  accountType(type: string) { return this.balance()?.detalle.filter(item => item.tipo === type) || []; }
  private money(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
}
