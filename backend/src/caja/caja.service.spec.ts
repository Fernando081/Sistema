import { CajaService } from './caja.service';
import { DataSource } from 'typeorm';

describe('CajaService',()=>{
  const query=jest.fn();
  const transaction=jest.fn((callback)=>callback({query}));
  const service=new CajaService({transaction} as unknown as DataSource);
  beforeEach(()=>{jest.clearAllMocks();});
  it('rechaza abrir sin usuario persistido',()=>{
    expect(()=>service.abrir({contado:100})).toThrow('usuario registrado');
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rechaza abrir si hay un turno activo',async()=>{
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{caja_chica:'100'}]).mockResolvedValueOnce([{id_turno:2}]);
    await expect(service.abrir({contado:100},1)).rejects.toThrow('Ya existe');
    expect(query).toHaveBeenCalledTimes(3);
  });
  it('rechaza cerrar un turno ya cerrado',async()=>{
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{caja_chica:'100'}]).mockResolvedValueOnce([{estado:'Cerrada'}]);
    await expect(service.cerrar(1,{contado:100},1)).rejects.toThrow('ya está cerrado');
  });
  it('rechaza una configuración ambigua de múltiples saldos',async()=>{
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{caja_chica:'100'},{caja_chica:'200'}]);
    await expect(service.abrir({contado:100},1)).rejects.toThrow('una sola caja');
  });
});
