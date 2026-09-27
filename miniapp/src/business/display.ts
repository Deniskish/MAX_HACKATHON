export function programmeCount(count: number) {
  const tens = count % 100,
    ones = count % 10;
  return `${count} ${tens >= 11 && tens <= 14 ? "программ" : ones === 1 ? "программа" : ones >= 2 && ones <= 4 ? "программы" : "программ"}`;
}
export function displayDate(value: string | null | undefined) {
  if (!value) return "не опубликован";
  const date = new Date(value.slice(0, 10) + "T12:00:00");
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "не опубликован";
}
