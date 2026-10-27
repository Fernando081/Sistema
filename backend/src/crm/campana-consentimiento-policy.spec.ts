import { commercialDestination,destinationHash,maskDestination } from './campana-consentimiento-policy';
describe('Destinos de promociones',()=>{
 it('deduplica mayúsculas y formato de correo, conservando etiquetas y puntos significativos',()=>{
  expect(commercialDestination('Correo',' Persona+filtros@EJEMPLO.COM ')).toBe('persona+filtros@ejemplo.com');
  expect(destinationHash('Correo','persona+filtros@ejemplo.com')).not.toBe(destinationHash('Correo','persona@ejemplo.com'));
  for(const invalid of['x@@example.com','a..b@example.com','.a@example.com','a.@example.com','a@example','a\nb@example.com','a@-example.com'])expect(commercialDestination('Correo',invalid)).toBeNull();
 });
 it('reconoce números mexicanos y E164 sin aceptar extensiones o cadenas arbitrarias',()=>{
  expect(commercialDestination('WhatsApp','833 123 4567')).toBe('+528331234567');
  expect(commercialDestination('Llamada','+52 (833) 123-4567')).toBe('+528331234567');
  expect(commercialDestination('Llamada','+1 212 555 0100')).toBe('+12125550100');
  for(const invalid of['8331234567 ext123','001528331234567','+0123456789','123',null])expect(commercialDestination('WhatsApp',invalid)).toBeNull();
 });
 it('separa bajas por canal y oculta destinos en la revisión masiva',()=>{
  expect(destinationHash('Llamada','+528331234567')).not.toBe(destinationHash('WhatsApp','+528331234567'));
  expect(maskDestination('persona@example.com')).toBe('p***@example.com');
  expect(maskDestination('+528331234567')).toBe('***4567');expect(maskDestination(null)).toBe('Destino inválido');
 });
});
