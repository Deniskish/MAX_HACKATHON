import { SaxesParser } from 'saxes';
import { validInn } from './inn';
import type { CompanyData } from './types';

export type Dataset = 'registry' | 'sme' | 'employees' | 'financials';
export type FNSRow = { inn: string; updatedAt: string; period?: number; data: Partial<CompanyData> };
export function fnsDate(value?: string): string | null {
  if (!value) return null;
  const date = /^\d{2}\.\d{2}\.\d{4}$/.test(value) ? value.split('.').reverse().join('-') : value;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : null;
}
const numeric = (s?: string) => s !== undefined && /^\d+(\.\d+)?$/.test(s) && Number.isFinite(Number(s)) ? Number(s) : null;
const regionNames: Record<string, string> = { '77': 'Москва', '78': 'Санкт-Петербург', '16': 'Республика Татарстан', '50': 'Московская область' };
// Selective SAX parser: no entity expansion, no personal address/name/director retention.
// Supports ЕГРЮЛ 4.07/4.08, ЕГРИП 4.06/4.07 including new reported OKVED elements.
export function createFNSParser(dataset: Dataset, updatedAt: string, emit: (row: FNSRow) => void, reportingPeriod?: number) {
  if (!fnsDate(updatedAt)) throw new Error('INVALID_SOURCE_DATE');
  const parser = new SaxesParser({ xmlns: false });
  const stack: string[] = [];
  let row: FNSRow | null = null, rootDepth = 0, root = '', text = '', reportedMain: string | null = null;
  let category: string | undefined;
  let count = 0, skipped = 0;
  parser.on('doctype', () => { throw new Error('XML_DOCTYPE_FORBIDDEN'); });
  parser.on('opentag', (node) => {
    stack.push(node.name);
    if (stack.length > 80) throw new Error('XML_DEPTH_LIMIT');
    const a = node.attributes as Record<string, string>;
    const name = node.name;
    if (!row && (dataset === 'registry' ? ['СвЮЛ', 'СвИП'].includes(name) : name === 'Документ')) {
      root = name; rootDepth = stack.length; reportedMain = null; category = a.КатСубМСП;
      row = { inn: a.ИНН ?? a.ИННФЛ ?? '', updatedAt: fnsDate(a.ДатаВып ?? a.ДатаДок ?? a.ДатаСост) ?? updatedAt, data: {} };
      if (dataset === 'registry') {
        const opf = a.ПолнНаимОПФ ?? a.НаимВидИП ?? '';
        row.data = { inn: row.inn, ogrn: a.ОГРН ?? a.ОГРНИП ?? null,
          name: null, companyType: name === 'СвИП' ? (/фермер/i.test(opf) ? 'КФХ' : 'ИП')
            : a.КодОПФ === '12300' || /ограниченной ответственностью/i.test(opf) ? 'ООО'
            : ['12247', '12267'].includes(a.КодОПФ) || /акционерное/i.test(opf) ? 'АО'
            : /фермер/i.test(opf) ? 'КФХ' : opf ? 'другое' : null,
          registrationDate: fnsDate(a.ДатаОГРН ?? a.ДатаОГРНИП), status: 'active', okvedAdditional: null };
      } else if (dataset === 'sme') {
        row.data = { isSme: true, smeCategory: ({ '1': 'micro', '2': 'small', '3': 'medium' } as const)[category as '1'] ?? null,
          smeRegistryUpdatedAt: fnsDate(a.ДатаСост) };
      } else {
        // ДатаСост is an as-of/publication date, not an annual accounting period.
        // The period is supplied explicitly from the official dataset passport.
        if (reportingPeriod !== undefined) row.period = reportingPeriod;
      }
      return;
    }
    if (!row) return;
    const relative = stack.slice(rootDepth);
    if (dataset === 'registry') {
      // Ignore similarly named nodes inside founders, predecessors and history entries.
      const branch = relative[0];
      if (name === 'СвНаимЮЛ' && relative.length === 1) row.data.name = a.НаимЮЛПолн ?? null;
      if (['СвОКВЭД', 'СвОКВЭДОтч'].includes(branch)) {
        if (name === 'СвОКВЭД') row.data.okvedAdditional = [];
        if (name === 'СвОКВЭДОсн') row.data.okvedMain = a.КодОКВЭД ?? null;
        if (name === 'СвОКВЭДОтчОсн') reportedMain = a.КодОКВЭД ?? null;
        if (['СвОКВЭДДоп', 'СвОКВЭДОтчДоп'].includes(name) && a.КодОКВЭД)
          row.data.okvedAdditional = [...new Set([...(row.data.okvedAdditional ?? []), a.КодОКВЭД])];
      }
      if (['СвАдресЮЛ', 'СвМНЮЛ', 'СвМЖФЛ', 'СвМЖИП'].includes(branch)) {
        if (a.КодРегион) row.data.region = regionNames[a.КодРегион] ?? a.НаимРегион ?? null;
        if (a.НаимРегион) row.data.region = a.НаимРегион;
        if (name === 'Регион' && a.НаимРегион) row.data.region = a.НаимРегион;
        if (name === 'НаимРегион') text = '';
      }
      if (relative.length === 1 && ['СвПрекрЮЛ', 'СвПрекращ'].includes(name)) row.data.status = 'terminated';
      if (branch === 'СвСтатус') row.data.status = 'restricted';
      if (relative.length === 1 && ['СвОбрЮЛ', 'СвРегЮЛ', 'СвРегИП'].includes(name))
        row.data.registrationDate = fnsDate(a.ДатаРег ?? a.ДатаОГРН ?? a.ДатаОГРНИП) ?? row.data.registrationDate;
    } else if (dataset === 'sme' && ['ОргВклМСП', 'ИПВклМСП'].includes(name)) {
      row.inn = a.ИННЮЛ ?? a.ИННФЛ ?? '';
    } else if (dataset !== 'sme' && name === 'СведНП') row.inn = a.ИННЮЛ ?? '';
    else if (dataset === 'employees' && name === 'СведССЧР') {
      row.data.employees = numeric(a.КолРаб); row.data.employeesPeriod = row.period ?? null;
    } else if (dataset === 'financials' && name === 'СведДохРасх') {
      // СумДоход is accounting income, NOT sales revenue. Revenue intentionally stays null.
      row.data.income = numeric(a.СумДоход); row.data.expenses = numeric(a.СумРасход);
      row.data.reportingPeriod = row.period ?? null;
    }
  });
  parser.on('text', (value) => { if (row && stack[stack.length - 1] === 'НаимРегион' && text.length < 200) text += value; });
  parser.on('closetag', (node) => {
    if (row && node.name === 'НаимРегион' && text.trim() && stack.slice(rootDepth).some((s) => ['СвАдресЮЛ', 'СвМНЮЛ', 'СвМЖФЛ', 'СвМЖИП'].includes(s))) row.data.region = text.trim();
    if (row && node.name === root && stack.length === rootDepth) {
      if (reportedMain) row.data.okvedMain = reportedMain;
      if (validInn(row.inn) && (dataset === 'registry' || dataset === 'sme' ? Object.keys(row.data).length > 0 : dataset === 'employees' ? 'employees' in row.data : 'income' in row.data)) { emit(row); count++; } else skipped++;
      row = null;
    }
    stack.pop();
  });
  return { write: (chunk: string) => parser.write(chunk), close: () => { parser.close(); return { count, skipped }; } };
}
