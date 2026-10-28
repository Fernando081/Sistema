import { ValidateBy } from 'class-validator';
export const DecimalPlaces = (limit: number) =>
  ValidateBy({
    name: 'decimalPlacesSafe',
    validator: {
      validate: (value: unknown) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return false;
        const [base, exponent] = value.toString().toLowerCase().split('e');
        return (
          Math.max(
            0,
            (base.split('.')[1]?.length ?? 0) - Number(exponent ?? 0),
          ) <= limit
        );
      },
      defaultMessage: () => `El número admite hasta ${limit} decimales`,
    },
  });
