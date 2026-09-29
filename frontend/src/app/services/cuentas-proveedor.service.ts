import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export interface SupplierInvoice {
  idFacturaProveedor:number; idProveedor:number; idOrden:number; folioOrden:number; serie?:string; folio:string; uuid?:string;
  fechaEmision:string; fechaVencimiento:string; total:number; saldo:number; estado:string; moneda:string;
  proveedor:string; tieneXml:boolean; tienePdf:boolean; discrepanciasPendientes:number;
}
export interface SupplierDashboard {
  resumen:{total:number;vencido:number;discrepancias:number;porConciliar:number};
  antiguedad:Array<{rango:string;facturas:number;saldo:number}>;
  recibidoSinFactura:Array<{idRecepcionDetalle:number;idRecepcion:number;folioOrden:number;proveedor:string;codigo:string;producto:string;fechaRecepcion:string;pendiente:number}>;
  anticipos:Array<{id:number;idProveedor:number;fecha:string;monto:number;saldo:number;formaPago:string;referencia?:string}>;
  notasCredito:Array<{id:number;idProveedor:number;fecha:string;folio:string;total:number;saldo:number}>;
}
export interface SupplierInvoiceDetail extends SupplierInvoice {
  id_proveedor:number; saldo_pendiente:number; canceladaAt?:string; motivoCancelacion?:string; canceladaPor?:string;
  partidas:Array<{idDetalle:number;codigo:string;descripcion:string;cantidad:number;conciliada:number;costoUnitario:number;tasaIva:number;importe:number}>;
  discrepancias:Array<{idDiscrepancia:number;tipo:string;esperado:number;recibido:number;diferencia:number;estado:string;justificacion?:string}>;
  programaciones:Array<{idProgramacion:number;fechaProgramada:string;monto:number;estado:string;notas?:string}>;
  pagos:Array<{idPago:number;fecha:string;monto:number;formaPago:string;referencia?:string;estado:string;revertidoAt?:string;motivoReversion?:string;revertidoPor?:string}>;
  aplicaciones:Array<{tipo:string;monto:number;estado:string;createdAt:string;motivoReversion?:string}>;
}

@Injectable({providedIn:'root'})
export class CuentasProveedorService {
  private readonly api=`${environment.apiBaseUrl}/cuentas-proveedor`;
  constructor(private readonly http:HttpClient){}
  dashboard(){return this.http.get<SupplierDashboard>(`${this.api}/dashboard`)}
  invoices(){return this.http.get<SupplierInvoice[]>(`${this.api}/facturas`)}
  invoice(id:number){return this.http.get<SupplierInvoiceDetail>(`${this.api}/facturas/${id}`)}
  create(dto:unknown){return this.http.post<{idFacturaProveedor:number;estado:string;discrepancias:number}>(`${this.api}/facturas`,dto)}
  uploadPdf(id:number,file:File){const data=new FormData();data.append('pdf',file);return this.http.post(`${this.api}/facturas/${id}/pdf`,data)}
  resolve(id:number,estado:'Aprobada'|'Rechazada',justificacion:string){return this.http.post(`${this.api}/discrepancias/${id}/resolver`,{estado,justificacion})}
  approve(id:number){return this.http.post(`${this.api}/facturas/${id}/aprobar`,{})}
  cancel(id:number,motivo:string){return this.http.post(`${this.api}/facturas/${id}/cancelar`,{motivo})}
  schedule(id:number,dto:unknown){return this.http.post(`${this.api}/facturas/${id}/programaciones`,dto)}
  pay(id:number,dto:unknown){return this.http.post(`${this.api}/facturas/${id}/pagos`,dto)}
  reversePayment(id:number,motivo:string){return this.http.post(`${this.api}/pagos/${id}/revertir`,{motivo})}
  credit(dto:unknown){return this.http.post(`${this.api}/notas-credito`,dto)}
  advance(dto:unknown){return this.http.post(`${this.api}/anticipos`,dto)}
  xml(id:number){return this.http.get(`${this.api}/facturas/${id}/xml`,{responseType:'blob'})}
  pdf(id:number){return this.http.get(`${this.api}/facturas/${id}/pdf`,{responseType:'blob'})}
}
