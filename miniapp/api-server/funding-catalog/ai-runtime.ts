import { AsyncLocalStorage } from 'node:async_hooks';
import { officialFundingCatalog } from './official-catalog';
import type { FundingOpportunity } from './types';
const context = new AsyncLocalStorage<FundingOpportunity[]>();
export const getAICatalog = () => context.getStore() ?? officialFundingCatalog;
export const withAICatalog = <T>(catalog: FundingOpportunity[], run: () => T): T => context.run(catalog, run);
