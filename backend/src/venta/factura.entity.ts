import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { CfdiRelacionado } from './cfdi-relacionado.entity';

@Entity('factura')
export class Factura {
  @PrimaryGeneratedColumn({ name: 'id_factura' })
  idFactura: number;

  @Column({ name: 'id_cliente' })
  idCliente: number;

  @Column({ name: 'tipo_comprobante', type: 'char', length: 1, default: 'I' })
  tipoComprobante: string;

  @Column({ name: 'serie', type: 'varchar', length: 10, default: 'A' })
  serie: string;

  @Column({ name: 'folio', type: 'int' })
  folio: number;

  @CreateDateColumn({ name: 'fecha_emision', type: 'timestamp with time zone' })
  fechaEmision: Date;

  @Column({ name: 'estatus' })
  estatus: string;

  @Column({ name: 'rfc_receptor' })
  rfcReceptor: string;

  @Column({ name: 'nombre_receptor' })
  nombreReceptor: string;

  @Column({ name: 'codigo_postal_receptor' })
  codigoPostalReceptor: string;

  @Column({ name: 'regimen_fiscal_receptor_clave' })
  regimenFiscalReceptorClave: string;

  @Column({ name: 'uso_cfdi_clave' })
  usoCfdiClave: string;

  @Column({ name: 'id_forma_pago' })
  idFormaPago: number;

  @Column({ name: 'id_metodo_pago' })
  idMetodoPago: number;

  @Column({ name: 'moneda', default: 'MXN' })
  moneda: string;

  @Column({ name: 'tipo_cambio', type: 'numeric', default: 1 })
  tipoCambio: number;

  @Column({ name: 'subtotal', type: 'numeric' })
  subtotal: number;

  @Column({ name: 'descuento', type: 'numeric', default: 0 })
  descuento: number;

  @Column({ name: 'total_impuestos_trasladados', type: 'numeric' })
  totalImpuestosTrasladados: number;

  @Column({ name: 'total_impuestos_retenidos', type: 'numeric' })
  totalImpuestosRetenidos: number;

  @Column({ name: 'total', type: 'numeric' })
  total: number;

  @Column({ name: 'uuid', type: 'uuid', nullable: true })
  uuid: string;

  @Column({ name: 'id_factura_global', type: 'int', nullable: true })
  idFacturaGlobal: number;

  @OneToMany(() => CfdiRelacionado, cfdiRelacionado => cfdiRelacionado.factura)
  cfdisRelacionados: CfdiRelacionado[];
}
