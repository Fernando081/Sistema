import { setAuditActor } from './audit-actor';

describe('Actor de auditoría acotado a transacción',()=>{
  it('parametriza el ID y usa configuración LOCAL, sin asignar contexto de sesión',async()=>{
    const source={query:jest.fn().mockResolvedValue([])};await setAuditActor(source,7);
    expect(source.query).toHaveBeenCalledWith("SELECT set_config('app.current_user_id',$1,true)",['7']);
  });
  it('no inventa un actor para bootstrap/identificadores inválidos',async()=>{
    const source={query:jest.fn().mockResolvedValue([])};
    for(const id of [undefined,0,-1,NaN,1.5,2147483648])await setAuditActor(source,id);expect(source.query).not.toHaveBeenCalled();
  });
});
