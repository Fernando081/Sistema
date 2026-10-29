import { destinationHash } from './campana-consentimiento-policy';
import { Consent } from './campana-consentimiento.service';
import { decidirDestinatario,mensajeCampana } from './campana-ejecucion.service';

describe('Simulación de campañas (O01.2c)', () => {
  const ahora = new Date('2026-10-29T18:00:00Z');
  const hash = destinationHash('Correo', 'ana@taller.mx');
  const contacto = { idCliente: 7, email: 'Ana@Taller.mx', telefono: null };
  const autorizado: Consent = { id_consentimiento: 1, id_contacto: 3, destino_hash: hash, estado: 'Autorizado', version: 1, vence_en: null, ocurrida_en: new Date('2026-10-01T00:00:00Z') };
  const base = { contacto, idCliente: 7, canal: 'Correo' as const, destinoHash: hash, bajas: new Set<string>(), ultimo: autorizado, ahora };

  it('simula sólo con autorización vigente sobre el mismo destino', () => {
    expect(decidirDestinatario(base)).toBe('Simulado');
  });

  it('revalida al procesar: baja, retiro, cambio de destino, autorización y vigencia', () => {
    expect(decidirDestinatario({ ...base, bajas: new Set([hash]) })).toBe('Baja');
    expect(decidirDestinatario({ ...base, contacto: null })).toBe('Contacto retirado');
    expect(decidirDestinatario({ ...base, contacto: { ...contacto, idCliente: 8 } })).toBe('Contacto retirado');
    expect(decidirDestinatario({ ...base, contacto: { ...contacto, email: 'otra@taller.mx' } })).toBe('Destino cambiado');
    expect(decidirDestinatario({ ...base, contacto: { ...contacto, email: 'no-es-correo' } })).toBe('Destino inválido');
    expect(decidirDestinatario({ ...base, ultimo: { ...autorizado, estado: 'Baja' } })).toBe('Sin autorización');
    expect(decidirDestinatario({ ...base, ultimo: undefined })).toBe('Sin autorización');
    expect(decidirDestinatario({ ...base, ultimo: { ...autorizado, vence_en: new Date('2026-10-29T17:59:00Z') } })).toBe('Vencido');
  });

  it('personaliza nombre y cliente sin tocar otros textos', () => {
    expect(mensajeCampana('Hola {{ nombre }}', 'Para {{cliente}}: {{otro}}', { nombre: 'Ana', cliente: 'Taller Sur' }))
      .toEqual({ asunto: 'Hola Ana', contenido: 'Para Taller Sur: {{otro}}' });
  });
});
