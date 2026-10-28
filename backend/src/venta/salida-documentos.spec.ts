import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SalidaCancelarDto, SalidaPrepararDto } from './salida-documentos.dto';
const base = {
  requestId: '38bf1b26-46bb-47cc-8534-5ffdac4102dd',
  evaluacionSha256: 'a'.repeat(64),
  confirmacion: true,
};
describe('Salida local de documentos: contrato deliberado', () => {
  it('acepta solicitud cerrada', async () =>
    expect(
      await validate(plainToInstance(SalidaPrepararDto, base), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toHaveLength(0));
  it.each([
    { confirmacion: false },
    { confirmacion: 'true' },
    { modo: 'Real' },
    { destinatario: 'libre@example.invalid' },
    { sql: 'SELECT 1' },
    { evaluacionSha256: 'x' },
  ])('rechaza %j', async (extra) =>
    expect(
      (
        await validate(
          plainToInstance(SalidaPrepararDto, { ...base, ...extra }),
          { whitelist: true, forbidNonWhitelisted: true },
        )
      ).length,
    ).toBeGreaterThan(0),
  );
  it('exige motivo no vacío para cancelar', async () =>
    expect(
      (
        await validate(
          plainToInstance(SalidaCancelarDto, {
            requestId: base.requestId,
            confirmacion: true,
            motivo: ' ',
          }),
        )
      ).length,
    ).toBeGreaterThan(0));
});
