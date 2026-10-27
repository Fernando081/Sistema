import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CrmBandejaQuery } from './crm-bandeja.dto';
describe('C03.1: consulta comercial cerrada y acotada', () => {
  it('normaliza búsqueda, pagina y fuentes con valores por defecto', async () => {
    const q = plainToInstance(CrmBandejaQuery, { q: '  Tornillo  ', page: '2' });
    expect(await validate(q)).toHaveLength(0);
    expect(q).toMatchObject({ q: 'Tornillo', page: 2, tipo: 'todos', plazo: 'todos' });
  });
  it.each([{page:0},{page:100001},{page:1.2},{q:null},{q:['a']},{q:'a'.repeat(101)},
    {tipo:'clientes'},{plazo:'ayer'},{idUser:123},{sql:'SELECT 1'},{page:'Infinity'}])('rechaza entrada fuera del contrato %j', async extra => {
    expect((await validate(plainToInstance(CrmBandejaQuery, extra), {whitelist:true,forbidNonWhitelisted:true})).length).toBeGreaterThan(0);
  });
});
