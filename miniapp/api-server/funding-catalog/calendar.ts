import type { FundingOpportunity } from './types';
const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
function fold(line: string): string {
  const lines: string[] = []; let current = '';
  for (const c of line) { if (new TextEncoder().encode(current + c).length > 73) { lines.push(current); current = ' '; } current += c; }
  return [...lines, current].join('\r\n');
}
export function calendarICS(catalog: FundingOpportunity[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Opora//Funding deadlines//RU', 'CALSCALE:GREGORIAN'];
  for (const o of catalog.filter((o) => o.deadline)) {
    const end = new Date(`${o.deadline}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
    lines.push('BEGIN:VEVENT', `UID:${o.id}@opora`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${o.deadline!.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, '')}`, `SUMMARY:${icsEscape(o.title)}`,
      `DESCRIPTION:${icsEscape(`Срок опубликован оператором. Статус: ${o.status}. Источник: ${o.source.url}`)}`, 'END:VEVENT');
  }
  return [...lines, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
