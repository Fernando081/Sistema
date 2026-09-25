import { DataSource } from 'typeorm';
import { AbastecimientoService } from './abastecimiento.service';

describe('AbastecimientoService costos adicionales',()=>{
  it('distribuye hasta el último centavo sin perder precisión',async()=>{
    const query=jest.fn(async(sql:string)=>{
      if(sql.includes('FROM recepcion_costo_adicional WHERE'))return [];
      if(sql.includes('FROM recepcion_compra_detalle WHERE'))return [
        {idDetalle:1,idProducto:10,cantidad:1,costo:10},
        {idDetalle:2,idProducto:20,cantidad:1,costo:20},
      ];
      if(sql.includes('INSERT INTO recepcion_costo_adicional('))return [{idCosto:7}];
      return [];
    });
    const manager={query};
    const source={transaction:jest.fn((callback:(value:typeof manager)=>unknown)=>callback(manager))} as unknown as DataSource;
    const service=new AbastecimientoService(source);
    await service.addReceiptCost(4,{requestId:'00000000-0000-4000-8000-000000000001',tipo:'Flete',monto:.01,criterio:'Valor'},2);
    const allocations=query.mock.calls.filter(([sql])=>sql.includes('recepcion_costo_adicional_detalle')).map(call=>call[1]?.[2]);
    expect(allocations).toEqual([0,.01]);
    expect(allocations.reduce((sum,value)=>sum+Number(value),0)).toBe(.01);
  });
});
