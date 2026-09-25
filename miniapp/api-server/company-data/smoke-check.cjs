// Report availability without exposing access credentials or company records.
(async () => {
  const response = await fetch('http://localhost:3002/api/providers/status', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('COMPANY_STATUS_FAILED');
  const { company } = await response.json();
  if (!company) throw new Error('COMPANY_STATUS_INVALID');
  console.log('Company data:', JSON.stringify({ provider: company.activeProvider, dadata: company.dadata, registry: company.fnsRegistry, sme: company.smeRegistry,
    employees: company.employees, financials: company.financials, lastSync: company.lastSync }));
  if (company.activeProvider === 'dadata') {
    const lookup = await fetch('http://localhost:3002/api/company/2126000147', { signal: AbortSignal.timeout(15000) });
    const result = await lookup.json();
    if (!lookup.ok || result.mode !== 'aggregator' || result.company?.inn !== '2126000147' || !result.profile?.name || !result.profile?.okved)
      throw new Error(`COMPANY_AUTOFILL_FAILED: HTTP ${lookup.status}`);
    console.log('Company autofill:', JSON.stringify({ mode: result.mode, inn: result.company.inn,
      fields: Object.keys(result.profile.provenance ?? {}), source: result.company.source }));
  } else if (company.fnsRegistry !== 'ready') console.warn('COMPANY_AUTOFILL_NOT_READY: import official registry data before enabling autofill.');
})().catch((error) => { console.error(error instanceof Error ? error.message : 'COMPANY_STATUS_FAILED'); process.exitCode = 1; });
