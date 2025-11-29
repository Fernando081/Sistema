// frontend/src/app/cliente/cliente.interface.ts

// ¡CAMBIO! Volvemos a usar camelCase (minúsculas)
export interface Cliente {
  idCliente: number;
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
  email?: string;
}

export type CreateClienteDto = Omit<Cliente, 'idCliente'>;
export type UpdateClienteDto = Partial<CreateClienteDto>;