// Совместимость с редактором документов и старой доменной моделью; факты только из snapshot.
import type { Program } from '../support-model';
import { officialFundingCatalog } from './official-catalog';
import { amountLabel, fundingKindLabels } from './presentation';
export const legacyPrograms: Program[] = officialFundingCatalog.map((o) => ({
  id: o.id, title: o.title, provider: o.providerName, type: fundingKindLabels[o.kind], amount: amountLabel(o),
  description: o.description, deadline: o.deadline ?? '', region: o.regions === 'all' ? 'Вся Россия' : o.regions.join(', '),
  icon: o.kind === 'guarantee' ? 'shield' : 'file', rules: [], documents: o.requiredDocuments,
  source: o.source.url!, benefit: { kind: o.kind === 'preferential_loan' || o.kind === 'loan' ? 'loan'
    : o.kind === 'subsidy' || o.kind === 'investment' ? 'grant' : o.kind === 'commercial_loan' ? 'loan' : o.kind,
    max: o.amountMax, explanation: o.description }, difficulty: 'Высокая', preparationDays: 0,
  sectors: o.sectors, version: o.version, updatedAt: o.source.verifiedAt!,
}));
