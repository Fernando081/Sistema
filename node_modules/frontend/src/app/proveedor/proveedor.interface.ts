// frontend/src/app/proveedor/proveedor.interface.ts (REEMPLAZAR)

// Esta interfaz es idéntica a la de Cliente,
// solo cambian los nombres de las propiedades.
export interface Proveedor {
  idProveedor: number;
  rfc: string;
  razonSocial: string;
  pais: string;
  idEstado: number;
  idMunicipio: number;
  ciudad: string;
  colonia: string;
  calle: string;
  codigoPostal: string;
  numeroExterior: string;
  numeroInterior: string;
  referencia: string;
  idMetodoDePago: number;
  idUsoCFDI: number;
  idFormaPago: number;
  idRegimenFiscal: number;
}

export type CreateProveedorDto = Omit<Proveedor, 'idProveedor'>;
export type UpdateProveedorDto = Partial<CreateProveedorDto>;