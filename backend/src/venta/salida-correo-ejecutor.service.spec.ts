import { SalidaCorreoEjecutorService } from './salida-correo-ejecutor.service';

describe('SalidaCorreoEjecutorService.decidir (O01.2b)', () => {
  const ejecutor = new SalidaCorreoEjecutorService({} as never, {} as never, {} as never);
  const reserva = { intentos: 1, maxIntentos: 3 };

  it('aceptado cierra Aceptado; permanente cierra Fallido sin reintentar', () => {
    expect(ejecutor.decidir({ tipo: 'aceptado', respuesta: '250 ok', codigo: 250 }, reserva)).toEqual(expect.objectContaining({ estado: 'Aceptado', cierre: 'Aceptado' }));
    expect(ejecutor.decidir({ tipo: 'permanente', detalle: '550 no', codigo: 550 }, reserva)).toEqual(expect.objectContaining({ estado: 'Fallido', cierre: 'Fallido' }));
  });

  it('temporal reintenta con espera hasta agotar intentos', () => {
    const r = ejecutor.decidir({ tipo: 'temporal', detalle: '451', codigo: 451 }, reserva);
    expect(r.estado).toBe('Reintento');
    expect(r.cierre).toBeNull();
    expect(r.proximo!.getTime()).toBeGreaterThan(Date.now() + 50_000);
    const agotado = ejecutor.decidir({ tipo: 'temporal', detalle: '451' }, { intentos: 3, maxIntentos: 3 });
    expect(agotado).toEqual(expect.objectContaining({ estado: 'Fallido', cierre: 'Fallido' }));
    expect(agotado.detalle).toContain('Agotó 3 intentos');
  });

  it('incierto no cierra ni programa reintento: espera conciliación humana', () => {
    expect(ejecutor.decidir({ tipo: 'incierto', detalle: 'conexión cortada' }, reserva)).toEqual(expect.objectContaining({ estado: 'Incierto', cierre: null, proximo: null }));
  });
});
