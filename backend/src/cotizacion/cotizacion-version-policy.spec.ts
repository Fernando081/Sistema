import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { quoteHash } from './cotizacion-version-policy';
import { ConceptoCotizacionDto } from './cotizacion.dto';
describe('Integridad de revisiones y cantidades',()=>{
 it('conserva la huella ante reordenar claves JSONB y distingue orden de renglones/importes exactos',()=>{
  expect(quoteHash({a:'1.00',b:[{x:'0.10',y:1}]})).toBe(quoteHash({b:[{y:1,x:'0.10'}],a:'1.00'}));
  expect(quoteHash({a:'1.00'})).not.toBe(quoteHash({a:'1.01'}));
  expect(quoteHash([1,2])).not.toBe(quoteHash([2,1]));
 });
 const fields={idProducto:1,descripcion:'Filtro',unidadDescripcion:'Pieza',valorUnitario:1,importe:1,importeIva:0,importeRetIsr:0};
 it.each([.000001,.1,1.123456])('admite cantidades válidas incluso con exponente: %s',cantidad=>expect(validateSync(plainToInstance(ConceptoCotizacionDto,{...fields,cantidad}))).toEqual([]));
 it.each([.0000001,1.1234567,NaN])('rechaza cantidad inválida sin TypeError: %s',cantidad=>expect(validateSync(plainToInstance(ConceptoCotizacionDto,{...fields,cantidad})).some(e=>e.property==='cantidad')).toBe(true));
});
