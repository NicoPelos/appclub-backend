export const PERIODO_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const periodoAnterior = (periodo) => {
  const [year, month] = periodo.split('-').map(Number);
  const prev = new Date(Date.UTC(year, month - 2, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;
};
