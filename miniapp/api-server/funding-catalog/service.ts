import { OfficialSnapshotProvider, type FundingProvider, fundingCatalogStatus } from './official-catalog';
import { matchFundingOpportunity, rankFundingMatches } from './matching';
import { buildFundingStrategy } from './strategy';
import type { FundingResponse } from './types';
import { fundingRecord, parseFundingNeed, parseFundingProfile, FundingInputError } from './input';

export class FundingCatalogService {
  constructor(private readonly now = () => new Date(), private readonly provider: FundingProvider = new OfficialSnapshotProvider()) {}
  getCatalog() { return this.provider.getCatalog(); }
  status() { return fundingCatalogStatus(this.getCatalog()); }
  match(input: unknown): FundingResponse {
    const body = fundingRecord(input);
    const profile = parseFundingProfile(body.profile);
    const need = parseFundingNeed(body.need);
    const documents = body.preparedDocuments === undefined ? {} : fundingRecord(body.preparedDocuments);
    // Отметки готовности — только заявления пользователя, не верификация документов.
    for (const value of Object.values(documents))
      if (!Array.isArray(value) || value.length > 30 || value.some((v) => typeof v !== 'string' || v.length > 200))
        throw new FundingInputError();
    const now = this.now();
    const matches = rankFundingMatches(this.getCatalog().map((opportunity) =>
      matchFundingOpportunity(profile, need, opportunity, {
        now, preparedDocuments: Object.prototype.hasOwnProperty.call(documents, opportunity.id)
          ? documents[opportunity.id] as string[] : [],
      })));
    return { mode: this.getCatalog().every((o) => o.source.type === 'official') ? 'official' : 'demo', need, matches, strategy: buildFundingStrategy(profile, need, matches) };
  }
}
