import { sessionClientLabel } from './auth-session.store';

describe('Etiqueta de sesión sin User-Agent completo',()=>{
  it('distingue navegador y sistema sin guardar versiones o datos añadidos',()=>{
    expect(sessionClientLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 private-contact@example.test')).toBe('Chrome · Windows');
    expect(sessionClientLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Edg/140.0')).toBe('Edge · Windows');
    expect(sessionClientLabel('Mozilla/5.0 (iPhone) Version/18 Safari/604')).toBe('Safari · iOS');
  });
  it('limita el análisis y devuelve etiquetas cerradas ante cabeceras arbitrarias',()=>{
    expect(sessionClientLabel('<script>alert(1)</script>')).toBe('Navegador no identificado');
    expect(sessionClientLabel('a'.repeat(512)+'Chrome/140')).toBe('Navegador no identificado');
    expect(sessionClientLabel()).toBe('Navegador no identificado');
  });
});
