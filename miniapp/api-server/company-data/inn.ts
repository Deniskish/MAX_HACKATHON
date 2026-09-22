// Проверяем контрольные цифры ИНН, но не существование компании в реестре.
export function validInn(inn: string): boolean {
  if (!/^(\d{10}|\d{12})$/.test(inn) || /^0+$/.test(inn)) return false;
  const d = [...inn].map(Number);
  const checksum = (weights: number[]) =>
    (weights.reduce((sum, w, i) => sum + w * d[i], 0) % 11) % 10;
  return d.length === 10
    ? checksum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9]
    : checksum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] &&
        checksum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}

export function innEntityType(inn: string): 'ЮЛ' | 'ИП' {
  if (!validInn(inn)) throw new InvalidInnError();
  // 12 цифр — ИНН физлица; наличие статуса ИП подтверждает только источник.
  return inn.length === 10 ? 'ЮЛ' : 'ИП';
}

export class InvalidInnError extends Error {
  constructor() { super('INVALID_INN'); }
}
