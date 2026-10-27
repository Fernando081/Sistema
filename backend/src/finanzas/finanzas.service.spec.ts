import { ContabilidadService } from './contabilidad.service';
import { ConciliacionService } from './conciliacion.service';
import { TesoreriaService } from './tesoreria.service';
import { TransferenciasCierresService } from './transferencias-cierres.service';
import { CorteFinancieroService } from './corte-financiero.service';
import { BadRequestException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { FinanzasService } from './finanzas.service';
import { Gasto } from './entities/gasto.entity';
import { Saldo } from './entities/saldo.entity';

describe('FinanzasService contabilidad', () => {
  const query = jest.fn();
  const runner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query,
  };
  const transaction = jest.fn(
    (callback: (manager: { query: typeof query }) => unknown) =>
      callback({ query }),
  );
  const source = {
    createQueryRunner: jest.fn(() => runner),
    query: jest.fn(),
    transaction,
  } as unknown as DataSource;
  const service = new FinanzasService(
    {} as Repository<Gasto>,
    {} as Repository<Saldo>,
    new ContabilidadService(source),
    new ConciliacionService(source),
    new TesoreriaService(source, new ConciliacionService(source)),
    new TransferenciasCierresService(source),
    new CorteFinancieroService(source, {} as Repository<Saldo>),
  );

  beforeEach(() => jest.clearAllMocks());

  it('rechaza una póliza manual descuadrada antes de escribir', async () => {
    await expect(
      service.crearPoliza({
        fecha: '2026-09-24',
        tipo: 'Diario',
        concepto: 'Ajuste',
        partidas: [
          { idCuenta: 1, debe: 100, haber: 0 },
          { idCuenta: 2, debe: 0, haber: 99 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(source.createQueryRunner).not.toHaveBeenCalled();
  });

  it('guarda una póliza cuadrada como borrador', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM cuenta_contable'))
        return [{ id_cuenta: 1 }, { id_cuenta: 2 }];
      if (sql.includes('INSERT INTO poliza_contable('))
        return [{ id_poliza: 17 }];
      return [];
    });
    await expect(
      service.crearPoliza(
        {
          fecha: '2026-09-24',
          tipo: 'Diario',
          concepto: 'Ajuste',
          partidas: [
            { idCuenta: 1, debe: 100, haber: 0 },
            { idCuenta: 2, debe: 0, haber: 100 },
          ],
        },
        1,
      ),
    ).resolves.toEqual({
      message: 'Póliza guardada como borrador',
      idPoliza: 17,
    });
    expect(runner.commitTransaction).toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('impide contabilizar manualmente una póliza automática', async () => {
    query.mockResolvedValueOnce([
      { estado: 'Contabilizada', automatica: true },
    ]);
    await expect(service.contabilizarPoliza(7)).rejects.toThrow('automáticas');
    expect(runner.rollbackTransaction).toHaveBeenCalled();
  });

  it('impide cerrar un periodo que todavía tiene borradores', async () => {
    query
      .mockResolvedValueOnce([
        {
          fechaInicio: '2026-09-01',
          fechaFin: '2026-09-30',
          estado: 'Abierto',
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);
    await expect(service.cerrarPeriodo(3, 1)).rejects.toThrow('borrador');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('cierra un periodo cuadrado y sin borradores', async () => {
    query
      .mockResolvedValueOnce([
        {
          fechaInicio: '2026-09-01',
          fechaFin: '2026-09-30',
          estado: 'Abierto',
        },
      ])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);
    await expect(service.cerrarPeriodo(3, 1)).resolves.toEqual({
      message: 'Periodo contable cerrado',
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("estado='Cerrado'"),
      [3, 1],
    );
  });

  it('excluye del presupuesto las pólizas que no pertenecen al periodo', async () => {
    (source.query as jest.Mock).mockResolvedValueOnce([]);

    await service.getPresupuestos({ anio: 2026, mes: 9 });

    const sql = (source.query as jest.Mock).mock.calls[0][0] as string;
    expect(sql).toContain('CASE WHEN p.id_poliza IS NULL THEN 0');
    expect(source.query).toHaveBeenCalledWith(sql, [2026, 9]);
  });
});
