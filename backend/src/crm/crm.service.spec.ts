import { CrmOportunidadesService } from './crm-oportunidades.service';
import { CrmUnidadesService } from './crm-unidades.service';
import { CrmComercialService } from './crm-comercial.service';
import { CrmActividadService } from './crm-actividad.service';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';
import { CrmService } from './crm.service';
import {
  CreateOportunidadDto,
  CreateSeguimientoDto,
  CreateUnidadClienteDto,
  CreateVentaPerdidaDto,
  OportunidadesQuery,
  UpdateOportunidadDto,
} from './crm.dto';
import { RolUsuario } from '../common/enums/app.enums';

describe('CRM: integridad de agenda e historial', () => {
  const current = {
    id_oportunidad: 3,
    id_cliente: 7,
    empresa: 'Taller Diesel',
    etapa: 'Contactado',
    version: 2,
    monto_estimado: '2000.00',
    siguiente_accion: 'Confirmar aplicación',
    fecha_siguiente_accion: '2026-10-01T16:00:00Z',
    motivo_perdida: null,
    contacto: 'Compras',
    telefono: '5555555555',
    email: 'compras@example.com',
    tipo_cliente: 'Taller',
  };
  let query: jest.Mock;
  let directQuery: jest.Mock;
  let service: CrmService;
  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    directQuery = jest.fn().mockResolvedValue([]);
    const source = {
      query: directQuery,
      transaction: async (work: (manager: unknown) => unknown) =>
        work({ query }),
    };
    const dataSource = source as unknown as DataSource;
    const oportunidades = new CrmOportunidadesService(dataSource);
    service = new CrmService(
      oportunidades,
      new CrmUnidadesService(dataSource, oportunidades),
      new CrmComercialService(dataSource),
      new CrmActividadService(dataSource),
    );
  });

  it('rechaza una versión antigua antes de modificar la oportunidad', async () => {
    query.mockResolvedValueOnce([current]);
    await expect(
      service.update(3, { etapa: 'Ganada', expectedVersion: 1 }, 9),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('bloquea el registro y conserva columnas omitidas al borrar un correo', async () => {
    query.mockResolvedValueOnce([current]);
    await service.update(3, { email: null, expectedVersion: 2 }, 9);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    const values = query.mock.calls[1][1];
    expect(values[3]).toBe('Compras');
    expect(values[5]).toBeNull();
    expect(values[9]).toBe('Confirmar aplicación');
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('cierra la agenda y deja historial con actor al ganar una oportunidad', async () => {
    query.mockResolvedValueOnce([current]);
    await service.update(3, { etapa: 'Ganada', expectedVersion: 2 }, 9);
    expect(query.mock.calls[1][1].slice(9, 12)).toEqual([null, null, null]);
    expect(query.mock.calls[2][1]).toEqual([
      3,
      'Etapa: Contactado → Ganada',
      9,
    ]);
  });
  it('no permite perder una cuenta sin motivo', async () => {
    query.mockResolvedValueOnce([current]);
    await expect(
      service.update(3, { etapa: 'Perdida', motivoPerdida: ' ' }, 9),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('no programa una fecha sin describir la acción', async () => {
    query.mockResolvedValueOnce([current]);
    await expect(
      service.update(3, { siguienteAccion: null }, 9),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('completar una actividad borra su agenda y conserva el resultado y actor', async () => {
    query
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([{ idSeguimiento: 12 }]);
    const result = await service.addSeguimiento(
      3,
      {
        tipo: 'Llamada',
        detalle: 'Motor confirmado',
        completarAccion: true,
        expectedVersion: 2,
      },
      9,
    );
    expect(result).toEqual({ idSeguimiento: 12 });
    expect(query.mock.calls[1][1]).toEqual([
      3,
      'Llamada',
      'Motor confirmado\nAcción completada: Confirmar aplicación',
      9,
    ]);
    expect(query.mock.calls[2][1]).toEqual([3, null, null]);
  });
  it('una nota simple conserva la acción pendiente', async () => {
    query
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([{ idSeguimiento: 12 }]);
    await service.addSeguimiento(
      3,
      { tipo: 'Nota', detalle: 'Contactar mañana' },
      9,
    );
    expect(query.mock.calls[2][1]).toEqual([
      3,
      current.siguiente_accion,
      current.fecha_siguiente_accion,
    ]);
  });
  it('impide programar acciones en una oportunidad cerrada', async () => {
    query.mockResolvedValueOnce([{ ...current, etapa: 'Ganada' }]);
    await expect(
      service.addSeguimiento(
        3,
        { tipo: 'Nota', detalle: 'Nueva visita', siguienteAccion: 'Visitar' },
        9,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('devuelve 404 al registrar seguimiento en una oportunidad inexistente', async () => {
    await expect(
      service.addSeguimiento(999, { tipo: 'Nota', detalle: 'Nota' }, 9),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rechaza asociar una venta perdida al cliente equivocado', async () => {
    query.mockResolvedValueOnce([current]);
    await expect(
      service.registrarVentaPerdida(
        {
          idOportunidad: 3,
          idCliente: 8,
          descripcionBuscada: 'Filtro',
          cantidad: 2,
          motivo: 'Sin existencia',
        },
        9,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('hereda el cliente de la oportunidad al registrar demanda no atendida', async () => {
    query
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([{ idVentaPerdida: 4 }]);
    await service.registrarVentaPerdida(
      {
        idOportunidad: 3,
        descripcionBuscada: 'Filtro',
        cantidad: 2,
        motivo: 'Sin existencia',
      },
      9,
    );
    expect(query.mock.calls[1][1]).toEqual([
      3,
      7,
      null,
      'Filtro',
      2,
      'Sin existencia',
      null,
      9,
    ]);
  });
  it('usa búsqueda parametrizada y escapa comodines con paginación estable', async () => {
    directQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);
    const result = await service.findAll(
      Object.assign(new OportunidadesQuery(), {
        q: "O'Hara_100%",
        page: 2,
        limit: 10,
      }),
    );
    expect(directQuery.mock.calls[0][1]).toEqual([
      null,
      "%O'Hara\\_100\\%%",
      null,
      10,
      10,
    ]);
    expect(result).toEqual({ data: [], total: 0, page: 2, limit: 10 });
  });
  it('registra VIN y ESN heredando el cliente y dejando historial', async () => {
    query
      .mockResolvedValueOnce([current])
      .mockResolvedValueOnce([{ idUnidad: 6 }])
      .mockResolvedValueOnce([]);
    await expect(
      service.addUnidad(
        3,
        { vin: '1M8GDM9AXKP042788', esn: 'isx-12345', motor: 'Cummins ISX' },
        9,
      ),
    ).resolves.toEqual({ idUnidad: 6 });
    expect(query.mock.calls[1][1].slice(0, 4)).toEqual([
      7,
      3,
      '1M8GDM9AXKP042788',
      'ISX-12345',
    ]);
    expect(query.mock.calls[2][1][1]).toContain('VIN 1M8GDM9AXKP042788');
  });
  it('exige VIN o ESN y valida el formato del VIN', async () => {
    await expect(service.addUnidad(3, {}, 9)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.addUnidad(3, { vin: 'VIN-CORTO' }, 9),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });
  it('registra una unidad directamente en la ficha del cliente sin exigir oportunidad', async () => {
    query
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([{ idUnidad: 8 }]);
    await expect(
      service.addUnidadCliente(7, { esn: 'isx-7788', numeroEconomico: 'T-14' }),
    ).resolves.toEqual({ idUnidad: 8 });
    expect(query.mock.calls[1][0]).toContain('VALUES ($1,NULL');
    expect(query.mock.calls[1][1].slice(0, 4)).toEqual([
      7,
      null,
      'ISX-7788',
      'T-14',
    ]);
  });
  it('rechaza registrar una unidad para un cliente inexistente', async () => {
    query.mockResolvedValueOnce([]);
    await expect(
      service.addUnidadCliente(999, { esn: 'ISX-7788' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('exige relacionar una encuesta con un cliente u oportunidad', async () => {
    await expect(
      service.createEncuesta({ calificacion: 5 }, 9),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(directQuery).not.toHaveBeenCalled();
  });
  it('impide que un usuario asigne una tarea CRM a otra persona', async () => {
    await expect(
      service.createTarea(
        {
          titulo: 'Llamar',
          prioridad: 'Alta',
          fechaVencimiento: '2026-10-01T10:00:00Z',
          idResponsable: 12,
          idCliente: 7,
        },
        9,
        RolUsuario.USER,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(directQuery).not.toHaveBeenCalled();
  });
  it('rechaza actualizar una versión antigua de una tarea CRM', async () => {
    query.mockResolvedValueOnce([
      {
        id_tarea: 4,
        id_responsable: 9,
        id_creador: 9,
        estado: 'Pendiente',
        version: 3,
      },
    ]);
    await expect(
      service.updateTarea(
        4,
        { estado: 'Completada', expectedVersion: 2 },
        9,
        RolUsuario.USER,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('CRM: límites de entrada', () => {
  const valid = {
    empresa: 'Taller',
    tipoCliente: 'Taller',
    etapa: 'Prospecto',
    montoEstimado: 0,
  };
  it('acepta contacto opcional vacío convirtiéndolo a null', async () => {
    const dto = plainToInstance(CreateOportunidadDto, {
      ...valid,
      email: ' ',
      fechaSiguienteAccion: '',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.email).toBeNull();
    expect(dto.fechaSiguienteAccion).toBeNull();
  });
  it('rechaza nombres y seguimientos de espacios', async () => {
    expect(
      await validate(
        plainToInstance(CreateOportunidadDto, { ...valid, empresa: '   ' }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(CreateSeguimientoDto, { tipo: 'Nota', detalle: '\n ' }),
      ),
    ).not.toHaveLength(0);
  });
  it('impide anular campos obligatorios de una edición parcial', async () => {
    const errors = await validate(
      plainToInstance(UpdateOportunidadDto, {
        empresa: null,
        montoEstimado: null,
      }),
    );
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['empresa', 'montoEstimado']),
    );
  });
  it('rechaza infinitos, negativos y solicitudes masivas de paginación', async () => {
    expect(
      await validate(
        plainToInstance(CreateVentaPerdidaDto, {
          descripcionBuscada: 'Filtro',
          cantidad: Infinity,
          motivo: 'Otro',
        }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(OportunidadesQuery, { page: -1, limit: 100000 }),
      ),
    ).toHaveLength(2);
  });
  it('normaliza VIN y ESN recibidos en el DTO', async () => {
    const dto = plainToInstance(CreateUnidadClienteDto, {
      vin: ' 1m8gdm9axkp042788 ',
      esn: ' isx-12345 ',
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.vin).toBe('1M8GDM9AXKP042788');
    expect(dto.esn).toBe('ISX-12345');
  });
});
