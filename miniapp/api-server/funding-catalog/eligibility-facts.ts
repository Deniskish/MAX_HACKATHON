import type { ApplicantType } from './types';

export type EligibilityFacts = { applicantTypes: ApplicantType[]; okvedPrefixes: string[];
  evidence: { applicants: string[]; okved: string[] } };
/** Conservative extraction from public recipient/requirement text, not titles or operator addresses. */
export function explicitEligibilityFacts(text: string): EligibilityFacts {
  const result: EligibilityFacts = { applicantTypes: [], okvedPrefixes: [], evidence: { applicants: [], okved: [] } };
  for (const quote of text.split(/\n+|(?<=[.!?])\s+(?=[А-ЯЁ])/u).map(s => s.trim()).filter(s => s && s.length <= 2000)) {
    // Negated lists and ranges need manual interpretation; never turn them into positive allowances.
    if (/не допуска|не могут|не вправе|не явля|за исключением|кроме|исключа|запрещ|не предоставля/i.test(quote)) continue;
    const recipientClause = quote.split(/[,;]?\s+(?:котор(?:ые|ым)|при условии|в случае|после победы)/i)[0];
    const recipient = /(?:участниками|заявителями|получателями).{0,60}(?:являются|могут быть)|к участию.{0,40}допускаются|могут (?:принимать участие|участвовать|подать заявк)|предоставляется\s+(?:юридическим|физическим|индивидуальным)/i.test(quote);
    if (recipient) {
      const types: [ApplicantType, RegExp][] = [
        ['legal_entity', /юридическ.{0,5}\s+лиц/i],
        ['individual_entrepreneur', /индивидуальн.{0,5}\s+предпринимател/i],
        ['individual', /физическ.{0,5}\s+лиц/i],
        ['team', /команд.{0,8}(?:без образования|без регистрации|без юридического лица)/i],
        ['project', /проект.{0,8}(?:без образования|без регистрации|без юридического лица)/i],
      ];
      for (const [type, pattern] of types) if (pattern.test(recipientClause)) {
        result.applicantTypes.push(type); result.evidence.applicants.push(quote);
      }
    }
    if (/например|пример|рекоменду|в том числе/i.test(quote)) continue;
    if (!/основн|требу|допуска|заявител|получател|участник|деятельност/i.test(quote)) continue;
    if (!/ОКВЭД/i.test(quote) || /дополнительн|\d\s*[-–—]\s*\d|\d\s+по\s+\d/i.test(quote)) continue;
    const list = quote.match(/ОКВЭД(?:\s*2(?=\s*[:)]))?\s*\)?\s*[:—-]?\s*((?:\d{2}(?:\.\d{1,2}){0,2})(?:\s*(?:,|;|или|и)\s*\d{2}(?:\.\d{1,2}){0,2})*)(?![\d.])/i)?.[1];
    if (list) {
      result.okvedPrefixes.push(...(list.match(/\d{2}(?:\.\d{1,2}){0,2}/g) ?? []));
      result.evidence.okved.push(quote);
    }
  }
  result.applicantTypes = [...new Set(result.applicantTypes)];
  result.okvedPrefixes = [...new Set(result.okvedPrefixes)];
  result.evidence.applicants = [...new Set(result.evidence.applicants)];
  result.evidence.okved = [...new Set(result.evidence.okved)];
  return result;
}
