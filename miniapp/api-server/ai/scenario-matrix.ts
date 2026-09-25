import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { runAssistant, type AIModel } from './service';
import { aiTasks, workspacePages } from './types';
import { PrivacyError } from '../privacy';
import { emptyFundingNeed, fundingPurposes, type FundingProfile } from '../funding-catalog/types';
import { officialFundingCatalog } from '../funding-catalog/official-catalog';
import { matchFundingOpportunity, rankFundingMatches } from '../funding-catalog/matching';
import { buildFundingStrategy } from '../funding-catalog/strategy';

async function main() {
  const cases: any[] = [], startedAt = new Date().toISOString();
  const profiles: Record<string, FundingProfile> = {
    incomplete: {}, company: { applicantType: 'legal_entity', companyType: 'ООО', region: 'Москва', okved: '28.1', isSme: 'yes', ageMonths: 36, revenue: 200000000, employees: 40 },
    project: { applicantType: 'project', region: 'Москва', industry: 'ПО', stage: 'prototype' },
  };
  for (const [profileName, profile] of Object.entries(profiles)) for (const task of aiTasks) for (const mode of ['success','unavailable','malformed','truncated','abort']) {
    const id = `MATRIX-${profileName}-${task}-${mode}`, controller = new AbortController(); let calls = 0;
    const model: AIModel = async stage => {
      calls++;
      if (mode === 'unavailable') throw new PrivacyError('PROVIDER_UNAVAILABLE');
      if (mode === 'truncated') throw new PrivacyError('TRUNCATED_RESPONSE');
      if (stage === 'plan') return { value: { query: 'оборудование', opportunityIds: [], ...(task === 'intake' ? { need: { purpose: 'покупка оборудования', amount: 400000 } } : {}) } };
      if (mode === 'malformed') return { value: { answer: '' } };
      return { value: { answer: 'Уточните источник средств.', evidenceIds: ['document:doc:2'], followups: ['Есть ли собственные средства?'],
        findings: task === 'review' ? [{ title: 'Бюджет', detail: 'Уточните источник.', severity: 'warning', evidenceId: 'document:doc:2', quote: 'Бюджет 400000 рублей.' }] : [],
        ...(task === 'draft' ? { draft: 'Описание проекта. Покупка оборудования. Срок [заполните].' } : {}),
        ...(task === 'workspace' ? { personalization: { summary: 'Уточните потребность.', sections: Object.fromEntries(workspacePages.map(page=>[page,{title:'Следующий шаг',text:'Укажите цель.',action:'funding'}])), priorities: [] } } : {}),
      } };
    };
    if (mode === 'abort') controller.abort();
    try {
      const execute = () => runAssistant({ task, question: 'Покупка оборудования за 400000 рублей', context: { profile, documents: [{ id:'doc',name:'Бюджет',pages:[{page:2,text:'Бюджет 400000 рублей.'}]}] } }, model, [], controller.signal);
      if (mode === 'abort') { await assert.rejects(execute); assert.equal(calls,0); }
      else {
        const result = await execute();
        assert.equal(result.mode, mode === 'success' ? 'llm' : 'local');
        assert.ok(result.actions.every(a=>!a.programId||result.matches.some(m=>m.id===a.programId&&!['not_eligible','expired','upcoming'].includes(m.status))));
        if (mode !== 'success') { assert.equal(result.draft,undefined); assert.equal(result.personalization,undefined); assert.equal(result.findings.length,0); }
        if (task === 'review' && mode === 'success') { assert.equal(calls,1); assert.equal(result.citations[0].page,2); }
        if (task === 'workspace' && mode === 'success') assert.equal(Object.keys(result.personalization!.sections).length,5);
      }
      cases.push({id,profile:profileName,task,condition:mode,status:'pass'});
    } catch(error) { cases.push({id,profile:profileName,task,condition:mode,status:'fail',error:error instanceof Error?error.message:'unknown'}); }
  }
  const fundingProfiles: Record<string,FundingProfile> = { ...profiles,
    large: {...profiles.company,companyType:'АО',isSme:'no',revenue:3000000000},
    unknownSme:{...profiles.company,isSme:'unknown'},
    entrepreneur:{applicantType:'individual_entrepreneur',companyType:'ИП',region:'Республика Татарстан',okved:'01.1',isSme:'yes',ageMonths:12},
    idea:{applicantType:'project',region:'Москва',stage:'idea'},
  };
  let combinations=0,checks=0;const failures:any[]=[],statuses:Record<string,number>={};
  for(const [profileName,profile] of Object.entries(fundingProfiles)) for(const purpose of fundingPurposes)
  for(const amount of [null,1,400000,100000000,2000000000]) for(const preferredTermMonths of [null,3,600])
  for(const ownFunds of [null,0,70000000]) for(const needsCollateralSupport of [null,false,true]) {
    combinations++;const need={...emptyFundingNeed,purpose,amount,preferredTermMonths,ownFunds,needsCollateralSupport};
    try {
      const matches=rankFundingMatches(officialFundingCatalog.map(o=>matchFundingOpportunity(profile,need,o)));
      for(const m of matches){checks++;statuses[m.status]=(statuses[m.status]||0)+1;
        assert.ok(Number.isFinite(m.score)&&m.score>=0&&m.score<=100);
        if(m.opportunity.status==='closed') assert.equal(m.status,'expired');
        if(m.status==='eligible') {assert.equal(m.missingRequirements.length,0);assert.equal(m.unknownRequirements.length,0);}
      }
      const strategy=buildFundingStrategy(profile,need,matches);
      assert.ok(strategy.options.every(o=>matches.some(m=>m.opportunity.id===o.opportunityId&&!['not_eligible','expired','upcoming'].includes(m.status))));
    }catch(error){if(failures.length<30)failures.push({profileName,need,error:error instanceof Error?error.message:'unknown'});}
  }
  const report={startedAt,endedAt:new Date().toISOString(),kind:'deterministic-and-simulated',ai:{cases,total:cases.length,passed:cases.filter(c=>c.status==='pass').length},funding:{profiles:Object.keys(fundingProfiles),purposes:fundingPurposes,amounts:[null,1,400000,100000000,2000000000],terms:[null,3,600],ownFunds:[null,0,70000000],collateral:[null,false,true],combinations,checks,statuses,failures}};
  writeFileSync(process.argv[2]||'scenario-matrix.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({aiTotal:cases.length,aiPassed:report.ai.passed,fundingCombinations:combinations,fundingChecks:checks,fundingFailures:failures.length}));
  if(report.ai.passed!==cases.length||failures.length)process.exitCode=1;
}
void main();
