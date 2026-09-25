// Report availability without exposing access credentials or company records.
(async () => {
  const response = await fetch('http://localhost:3002/api/providers/status', { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('COMPANY_STATUS_FAILED');
  const { company } = await response.json();
  if (!company) throw new Error('COMPANY_STATUS_INVALID');
  console.log('Company data:', JSON.stringify({ registry: company.fnsRegistry, sme: company.smeRegistry,
    employees: company.employees, financials: company.financials, lastSync: company.lastSync }));
  if (company.fnsRegistry !== 'ready') console.warn('COMPANY_AUTOFILL_NOT_READY: import official registry data before enabling autofill.');
})().catch((error) => { console.error(error instanceof Error ? error.message : 'COMPANY_STATUS_FAILED'); process.exitCode = 1; });
