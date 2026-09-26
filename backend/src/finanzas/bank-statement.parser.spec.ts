import { BadRequestException } from '@nestjs/common';
import { parseBankStatementCsv } from './bank-statement.parser';

describe('parseBankStatementCsv',()=>{
  it('lee CSV separado por punto y coma con importes mexicanos y cargos/abonos',()=>{
    const result=parseBankStatementCsv(Buffer.from('Fecha;Descripción;Referencia;Cargo;Abono\n26/09/2026;Pago proveedor;ABC;1.234,50;0\n2026-09-27;Depósito;XYZ;0;2,000.25'));
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {line:2,date:'2026-09-26',description:'Pago proveedor',reference:'ABC',amount:-1234.5},
      {line:3,date:'2026-09-27',description:'Depósito',reference:'XYZ',amount:2000.25},
    ]);
  });

  it('conserva las filas válidas e informa las inválidas',()=>{
    const result=parseBankStatementCsv(Buffer.from('Fecha,Descripcion,Monto\n2026-09-26,Correcto,100.25\n31/02/2026,Incorrecto,20'));
    expect(result.rows).toHaveLength(1);expect(result.errors).toEqual([{line:3,message:'Fecha inválida'}]);
  });

  it('rechaza archivos que no tienen las columnas mínimas',()=>{
    expect(()=>parseBankStatementCsv(Buffer.from('A,B\n1,2'))).toThrow(BadRequestException);
  });
});
