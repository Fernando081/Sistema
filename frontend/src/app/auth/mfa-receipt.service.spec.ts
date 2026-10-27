import { MfaReceiptService } from './mfa-receipt.service';

describe('Entrega temporal de respaldos MFA',()=>{
  it('entrega una sola vez, copia el origen y no persiste en almacenamiento',()=>{
    const service=new MfaReceiptService(),codes=['public-test-fixture'];
    const local=spyOn(localStorage,'setItem'),session=spyOn(sessionStorage,'setItem');
    service.publish(codes);codes[0]='changed-fixture';
    expect(service.take()).toEqual(['public-test-fixture']);expect(service.take()).toEqual([]);
    expect(local).not.toHaveBeenCalled();expect(session).not.toHaveBeenCalled();
  });
});
