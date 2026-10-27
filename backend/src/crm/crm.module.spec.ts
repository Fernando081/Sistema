import { Test } from '@nestjs/testing';
import { Provider } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CrmModule } from './crm.module';
import { CrmService } from './crm.service';
import { CrmTareasQuery } from './crm.dto';
import { RolUsuario } from '../common/enums/app.enums';

describe('Composición CRM por dominio', () => {
  it('registra unidad e historial con el mismo manager y bloqueo de oportunidad', async () => {
    const transactionQuery = jest.fn()
      .mockResolvedValueOnce([{ id_oportunidad: 3, id_cliente: 7, version: 2 }])
      .mockResolvedValueOnce([{ idUnidad: 8 }])
      .mockResolvedValueOnce([]);
    const directQuery = jest.fn();
    const transaction = jest.fn(async (work: (manager: unknown) => unknown) => work({ query: transactionQuery }));
    const providers = Reflect.getMetadata('providers', CrmModule) as Provider[];
    const module = await Test.createTestingModule({ providers: [
      ...providers,
      { provide: getDataSourceToken(), useValue: { query: directQuery, transaction } },
    ] }).compile();
    try {
      await expect(module.get(CrmService).addUnidad(3, { esn: ' isx-123 ' }, 9)).resolves.toEqual({ idUnidad: 8 });
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(directQuery).not.toHaveBeenCalled();
      expect(transactionQuery).toHaveBeenNthCalledWith(1, expect.stringContaining('FOR UPDATE'), [3]);
      expect(transactionQuery.mock.calls[1][1].slice(0, 4)).toEqual([7, 3, null, 'ISX-123']);
      expect(transactionQuery).toHaveBeenNthCalledWith(3, expect.stringContaining('INSERT INTO crm_seguimiento'), [3, 'Unidad registrada · ESN ISX-123', 9]);
    } finally { await module.close(); }
  });

  it('conserva el filtro de propietario en consultas de tareas de usuarios comunes', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const providers = Reflect.getMetadata('providers', CrmModule) as Provider[];
    const module = await Test.createTestingModule({ providers: [
      ...providers, { provide: getDataSourceToken(), useValue: { query } },
    ] }).compile();
    try {
      await module.get(CrmService).tareas(new CrmTareasQuery(), 9, RolUsuario.USER);
      expect(query).toHaveBeenCalledWith(expect.stringContaining('t.id_responsable=$2 OR t.id_creador=$2'), [false, 9]);
    } finally { await module.close(); }
  });
});
