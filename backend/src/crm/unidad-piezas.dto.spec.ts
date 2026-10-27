import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CrearPiezaDto } from './unidad-piezas.dto';

describe('Cantidades y fechas de instalación', () => {
 const fields = {requestId: '6c86865b-1c9a-47b4-a37f-7b7c05e78585', idConcepto: 1, fecha: '2026-10-20T10:00:00-06:00', detalle: 'Reportado por el cliente', compatibilidad: 'Pendiente', referencia: 'Falta revisión de catálogo'};
 it.each([0.000001, 0.1, 0.2, 1.234567, 1000000])('admite seis decimales sin fallar con notación científica: %s', cantidad => {
  expect(validateSync(plainToInstance(CrearPiezaDto, {...fields, cantidad}))).toEqual([]);
 });
 it.each([0.0000001, 1.2345678, 0, -1, NaN, Infinity])('rechaza cantidad inválida sin arrojar TypeError: %s', cantidad => {
  expect(validateSync(plainToInstance(CrearPiezaDto, {...fields, cantidad})).some(e => e.property === 'cantidad')).toBe(true);
 });
 it('rechaza días inexistentes y fechas sin zona explícita', () => {
  for (const fecha of ['2026-02-30T10:00:00Z', '2026-10-20T10:00:00']) {
   expect(validateSync(plainToInstance(CrearPiezaDto, {...fields, cantidad: 1, fecha})).some(e => e.property === 'fecha')).toBe(true);
  }
 });
});
