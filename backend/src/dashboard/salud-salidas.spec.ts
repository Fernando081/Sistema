import { MetricasSalidas, evaluarSalidas, leerUmbrales, nivelGeneral } from './salud-salidas';

const base = (): MetricasSalidas => ({
  correo: { modo: 'desactivado', pendientes: 0, enCurso: 0, inciertos: 0, fallidos7d: 0, aceptados7d: 0, masAntiguoMin: null },
  reportes: { pendientes: 0, enCurso: 0, agotados: 0, agotados7d: 0, masAntiguoMin: null },
  fiscal: { pendientes: 0, sinRespuesta: 0, errores7d: 0, masAntiguoHoras: null },
  campanas: { enCurso: 0, pendientes: 0, masAntiguoMin: null },
  almacenamiento: { baseBytes: 50 * 1048576, pdfBytes: 0, documentos: 0, historialJobs: 0, notificaciones: 0 },
  retencion: { dias: 90, pdfsCerrados: 0, pdfBytesCerrados: 0, historialJobs: 0, notificacionesLeidas: 0 },
});
const umbrales = leerUmbrales({});
const area = (m: MetricasSalidas, key: string) => evaluarSalidas(m, umbrales).find((a) => a.area === key)!;

describe('O01.3a · salud de las salidas', () => {
  it('sin acumulación todas las áreas están bien', () => {
    const areas = evaluarSalidas(base(), umbrales);
    expect(areas.map((a) => a.area)).toEqual(['correo', 'reportes', 'fiscal', 'campanas', 'almacenamiento']);
    expect(areas.every((a) => a.nivel === 'ok' && a.mensajes.length === 0)).toBe(true);
    expect(nivelGeneral(areas)).toBe('ok');
  });

  it('umbrales por defecto y valores inválidos', () => {
    expect(umbrales).toEqual({ colaMax: 200, baseMaxMb: 4096, pdfMaxMb: 1024, retencionDias: 90 });
    expect(leerUmbrales({ OPERACION_COLA_MAX: '5', OPERACION_RETENCION_DIAS: 'x', OPERACION_BD_MAX_MB: '2048' })).toEqual({ colaMax: 200, baseMaxMb: 2048, pdfMaxMb: 1024, retencionDias: 90 });
  });

  it('correo: espera con correo desactivado es atención; espera larga con correo activo es crítica', () => {
    const m = base();
    m.correo.pendientes = 3;
    m.correo.masAntiguoMin = 600;
    expect(area(m, 'correo')).toMatchObject({ nivel: 'atencion', mensajes: ['3 envíos esperan, pero el correo está desactivado (MAIL_MODE).'] });
    m.correo.modo = 'smtp';
    expect(area(m, 'correo').nivel).toBe('critico');
    expect(area(m, 'correo').mensajes[0]).toContain('10 h en espera');
  });

  it('correo: inciertos y fallidos piden revisión; la crítica va primero', () => {
    const m = base();
    m.correo.inciertos = 2;
    m.correo.fallidos7d = 1;
    m.correo.pendientes = 201;
    const r = area(m, 'correo');
    expect(r.nivel).toBe('critico');
    expect(r.mensajes[0]).toContain('superan el límite de 200');
    expect(r.mensajes).toHaveLength(4);
  });

  it('reportes agotados y espera mayor a una hora', () => {
    const m = base();
    m.reportes.agotados = 4;
    expect(area(m, 'reportes').nivel).toBe('ok');
    m.reportes.agotados7d = 1;
    m.reportes.masAntiguoMin = 61;
    expect(area(m, 'reportes')).toMatchObject({ nivel: 'atencion' });
    expect(area(m, 'reportes').mensajes).toHaveLength(2);
  });

  it('fiscal: sin respuesta del SAT, errores recientes y antigüedad sin duplicar el aviso', () => {
    const m = base();
    m.fiscal.pendientes = 1;
    m.fiscal.masAntiguoHoras = 80;
    expect(area(m, 'fiscal').mensajes).toEqual(['La cancelación pendiente más antigua lleva 80 h.']);
    m.fiscal.sinRespuesta = 1;
    m.fiscal.errores7d = 2;
    expect(area(m, 'fiscal').mensajes).toEqual(['1 cancelaciones llevan días sin respuesta del SAT.', '2 documentos fiscales quedaron en Error en 7 días; vuelve a timbrarlos o revisa el PAC.']);
  });

  it('campañas: una simulación detenida y almacenamiento sobre el aviso', () => {
    const m = base();
    m.campanas = { enCurso: 1, pendientes: 40, masAntiguoMin: 90 };
    expect(area(m, 'campanas').mensajes[0]).toContain('40 destinatarios pendientes');
    m.almacenamiento.baseBytes = 5000 * 1048576;
    m.almacenamiento.pdfBytes = 2000 * 1048576;
    expect(area(m, 'almacenamiento').mensajes).toHaveLength(2);
    expect(nivelGeneral(evaluarSalidas(m, umbrales))).toBe('atencion');
  });
});
