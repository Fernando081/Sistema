import { Test } from '@nestjs/testing';
import { Provider } from '@nestjs/common';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { FinanzasModule } from './finanzas.module';
import { FinanzasService } from './finanzas.service';
import { Gasto } from './entities/gasto.entity';
import { Saldo } from './entities/saldo.entity';

describe('Composición del módulo de finanzas', () => {
  it('resuelve los proveedores reales y ejecuta consultas a través de la fachada', async () => {
    const query = jest.fn().mockResolvedValue([{ idCuenta: 7, nombre: 'Cuenta local' }]);
    const providers = Reflect.getMetadata('providers', FinanzasModule) as Provider[];
    const module = await Test.createTestingModule({
      providers: [
        ...providers,
        { provide: getDataSourceToken(), useValue: { query } },
        { provide: getRepositoryToken(Gasto), useValue: {} },
        { provide: getRepositoryToken(Saldo), useValue: {} },
      ],
    }).compile();
    try {
      const service = module.get(FinanzasService);
      await expect(service.getCuentasTesoreria()).resolves.toEqual([{ idCuenta: 7, nombre: 'Cuenta local' }]);
      await expect(service.getCuentasContables()).resolves.toEqual([{ idCuenta: 7, nombre: 'Cuenta local' }]);
      expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('tesoreria_cuenta'), undefined);
      expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining('cuenta_contable'), undefined);
    } finally { await module.close(); }
  });
});
