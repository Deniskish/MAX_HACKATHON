import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fundingSources, sourceForRegion, sourceUrl, type FundingSource } from './source-registry';
import { readProgrammePage, type ProgrammePage } from './web-page';
import { verifiedOpportunity } from './extraction';
import { OfficialWebCatalog } from './web-catalog';
import { LiveCatalog } from './live';
import { currentImported, measureKey, mergeCatalog } from './identity';
import { NotificationStore, NotificationWorker } from './notifications';
import { emptyFundingNeed } from './types';
import { createApp } from '../app';

const source: FundingSource = { id: 'testfund', name: 'Официальный фонд', hosts: ['fund.example'], seeds: ['https://fund.example/programs/'], paths: ['/programs/'], providerType: 'fund' };
const text = 'Грант на производство. Программа действует на территории Российской Федерации. Получатели — юридические лица, субъекты МСП. Поддерживается производство мебели. Приём заявок осуществляется круглогодично. Требуется бизнес-план. '.repeat(2);
const page: ProgrammePage = { url: 'https://fund.example/programs/production/', title: 'Грант на производство', text, links: [] };
const extraction = () => ({ isMeasure: true, title: 'Грант на производство', kind: 'grant', regions: 'all', applicantTypes: ['legal_entity'],
  startsAt: null, endsAt: null, ongoing: true, accepting: true, requiredDocuments: ['бизнес-план'], evidence: {
    title: 'Грант на производство', kind: 'Грант на производство', geography: 'Программа действует на территории Российской Федерации.',
    applicants: 'Получатели — юридические лица, субъекты МСП.', conditions: 'Поддерживается производство мебели.',
    dates: 'Приём заявок осуществляется круглогодично.', acceptance: 'Приём заявок осуществляется круглогодично.' } });
const item = () => verifiedOpportunity(extraction(), page, source)!;

test('only grounded official programme facts pass; guesses, invented quotes and unsupported territories stay out', () => {
  const valid = item(); assert.equal(valid.status, 'active'); assert.equal(valid.imported?.verification, 'verified');
  assert.equal(valid.amountMax, null); assert.equal(valid.deadline, null);
  for (const mutate of [
    (v: any) => { v.title = 'Придуманная субсидия'; },
    (v: any) => { v.evidence.conditions = 'Одобрение всем гарантировано'; },
    (v: any) => { v.regions = ['Томская область']; },
    (v: any) => { v.applicantTypes = ['individual']; },
    (v: any) => { v.requiredDocuments = ['Паспорт директора']; },
    (v: any) => { v.endsAt = '2030-01-01'; },
    (v: any) => { v.kind = 'loan'; },
  ]) { const value = extraction(); mutate(value); assert.throws(() => verifiedOpportunity(value, page, source)); }
  assert.equal(verifiedOpportunity({isMeasure:false},page,source),null);
  assert.throws(()=>verifiedOpportunity(extraction(),page,{...source,region:'Москва'}));
});

test('programme dates, perpetual intake and freshness never default to active', () => {
  const value = {...extraction(),ongoing:false,accepting:false};
  assert.equal(verifiedOpportunity(value,page,source)?.status,'unknown');
  const dated = {...extraction(),ongoing:false,startsAt:'2020-01-01',endsAt:'2020-02-01',evidence:{...extraction().evidence,dates:'с 01.01.2020 по 01.02.2020'}};
  assert.equal(verifiedOpportunity(dated,{...page,text:page.text+' с 01.01.2020 по 01.02.2020'},source)?.status,'closed');
  assert.throws(()=>verifiedOpportunity({...dated,endsAt:'2020-02-31'},page,source));
  const o=item();assert.equal(currentImported(o,Date.now()),true);
  o.imported!.checkedAt=new Date(Date.now()-7200000).toISOString();assert.equal(currentImported(o,Date.now(),new Date().toISOString()),false);
});

test('source redirects, hosts, schemes and response size are bounded; programme links remain official', async () => {
  for (const url of ['http://fund.example/programs/a','https://fund.example.evil/programs/a','https://user:pass@fund.example/programs/a','https://fund.example:4430/programs/a','https://fund.example/private/a']) assert.equal(sourceUrl(url,source),null);
  await assert.rejects(readProgrammePage(source.seeds[0],source,async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}})),/UNTRUSTED/);
  await assert.rejects(readProgrammePage(source.seeds[0],source,async()=>new Response('a'.repeat(2000001),{headers:{'Content-Type':'text/html'}})),/TOO_LARGE/);
  const html=`<html><head><title>Программа</title></head><body><main><h1>Программа</h1><p>${text}</p><a href="/programs/production/">Грант</a><a href="https://evil.test/">Грант</a><script>DO_NOT_INCLUDE</script></main></body></html>`;
  const parsed=await readProgrammePage(source.seeds[0],source,async()=>new Response(html,{headers:{'Content-Type':'text/html'}}));
  assert.deepEqual(parsed.links,[page.url]);assert.doesNotMatch(parsed.text,/DO_NOT_INCLUDE/);
});

test('independent source imports survive another source outage, restarts and failed changed-page extraction', async () => {
  const dir=mkdtempSync(path.join(tmpdir(),'opora-web-'));let broken=false;
  const other={...source,id:'broken',hosts:['broken.example'],seeds:['https://broken.example/programs/']};
  const read=async(url:string,s:FundingSource)=>{
    if(s.id==='broken') throw new Error('SOURCE_HTTP_500');
    return url===source.seeds[0]?{...page,url,links:[page.url]}:{...page,text:page.text+(broken?' Изменённые условия.':'')};
  };
  try {
    const web=new OfficialWebCatalog(dir,async()=>{if(broken)throw new Error('EXTRACTION_AI_UNAVAILABLE');return extraction();},[source,other],read);
    await web.sync();assert.equal(web.getCatalog().length,1);assert.equal(web.status().sources.find(s=>s.id==='broken')?.error,'SOURCE_HTTP_500');
    const loaded=new OfficialWebCatalog(dir,undefined,[source,other],read);assert.equal(loaded.getCatalog().length,1);
    broken=true;await web.sync();assert.equal(web.getCatalog().length,1);assert.equal(web.getCatalog()[0].status,'unknown');
    assert.equal(web.getCatalog()[0].imported?.verification,'pending');
    assert.equal(new OfficialWebCatalog(dir,undefined,[source,other],read).getCatalog()[0].status,'unknown');
    broken=false;await web.sync();assert.equal(web.getCatalog()[0].status,'active');
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('regional interest enables only configured official operators and records missing coverage', async () => {
  assert.equal(sourceForRegion('Чувашия')[0].id,'chuvashia');assert.equal(sourceForRegion('Московская область').length,0);
  const dir=mkdtempSync(path.join(tmpdir(),'opora-interest-'));let reads=0;
  try {
    const regional={...source,region:'Москва',aliases:['г. Москва']};
    const web=new OfficialWebCatalog(dir,async()=>extraction(),[regional],async()=>{reads++;return {...page,url:source.seeds[0]};});
    await web.sync();assert.equal(reads,0);web.registerInterest('г. Москва');await web.sync();assert.equal(reads,1);
    web.registerInterest('Томская область');assert.deepEqual(web.status().unsupportedRegions,['Томская область']);
    assert.equal(new OfficialWebCatalog(dir,undefined,[regional]).status().sources[0].enabled,true);
    assert.ok(fundingSources.every(s=>s.seeds.every(url=>sourceUrl(url,s))));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('identity collapses exact duplicate programmes, not distinct regions or intakes', () => {
  const o=item(), duplicate={...o,id:'other',source:{...o.source,url:'https://fund.example/programs/alias/'}};
  assert.equal(measureKey(o),measureKey(duplicate));assert.equal(mergeCatalog([o,duplicate]).length,1);
  assert.equal(mergeCatalog([o,{...duplicate,regions:['Москва']}]).length,2);
  assert.equal(mergeCatalog([o,{...duplicate,deadline:'2030-01-01'}]).length,2);
});

test('verified web programmes notify despite Minfin outage, no duplicates after changed version, no blind resend after timeout', async () => {
  const store=new NotificationStore(':memory:');let o=item(),sends=0;
  const catalog={getCatalog:()=>[o],status:()=>({checkedAt:null}),enrich:async()=>o} as unknown as LiveCatalog;
  store.subscribe('1',{region:'Москва',companyType:'ООО',industry:'Производство мебели'},emptyFundingNeed,true);
  try {
    const worker=new NotificationWorker(store,catalog,async()=>({relevant:true,reason:'Поддержка производства мебели',quotes:['Поддерживается производство мебели.']}),async()=>{sends++;throw new Error('timeout');});
    await worker.tick();assert.equal(store.list('1').length,1);assert.equal(sends,1);
    assert.equal((store.list('1')[0] as any).delivery,'unconfirmed');
    o={...o,version:'changed-version',id:'duplicate-alias'};await worker.tick(Date.now()+120000);
    assert.equal(store.list('1').length,1);assert.equal(sends,1);
  }finally{store.db.close();}
});

test('unverified or stale web measures never reach AI or delivery even when Minfin is fresh', async () => {
  const store=new NotificationStore(':memory:');store.subscribe('1',{region:'Москва',industry:'Производство'},emptyFundingNeed,true);let calls=0;
  try {for(const verification of ['pending','verified'] as const){const o=item();o.imported!.verification=verification;o.imported!.checkedAt='2020-01-01';
    const catalog={getCatalog:()=>[o],status:()=>({checkedAt:new Date().toISOString()}),enrich:async()=>o} as unknown as LiveCatalog;
    await new NotificationWorker(store,catalog,async()=>{calls++;return{relevant:true,reason:'',quotes:[]};},async()=>{calls++;}).tick();}
    assert.equal(calls,0);assert.equal(store.list('1').length,0);
  }finally{store.db.close();}
});

test('a programme changed during AI analysis or final delivery verification is not announced', async () => {
  for (const phase of ['analysis', 'delivery']) {
    const store = new NotificationStore(':memory:'); let o = item(), reads = 0, sent = 0;
    store.subscribe('1', { region: 'Москва', companyType: 'ООО', industry: 'Производство мебели' }, emptyFundingNeed, true);
    const catalog = { getCatalog: () => [o], status: () => ({ checkedAt: null }), enrich: async () => {
      if (++reads === 2 && phase === 'delivery') o = { ...o, version: 'new-conditions' };
      return o;
    } } as unknown as LiveCatalog;
    try {
      await new NotificationWorker(store, catalog, async () => {
        if (phase === 'analysis') o = { ...o, version: 'new-conditions' };
        return { relevant: true, reason: 'Поддержка производства мебели', quotes: ['Поддерживается производство мебели.'] };
      }, async () => { sent++; }).tick();
      assert.equal(sent, 0);
      if (phase === 'analysis') assert.equal(store.list('1').length, 0);
      else assert.equal((store.list('1')[0] as any).delivery, 'cancelled');
    } finally { store.db.close(); }
  }
});

test('team monitoring is protected and regional interest accepts no arbitrary source URL', async () => {
  const dir=mkdtempSync(path.join(tmpdir(),'opora-monitor-'));
  const catalog=new LiveCatalog(dir);const web=new OfficialWebCatalog(path.join(dir,'web'),undefined,[source]);catalog.attachWeb(web);
  const app=createApp({giga:null,catalog,env:{OPORA_MONITOR_TOKEN:'team-secret'}});const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as any).port}`;
  try {
    assert.equal((await fetch(base+'/api/internal/funding/status')).status,404);
    assert.equal((await fetch(base+'/api/internal/funding/status',{headers:{Authorization:'Bearer wrong'}})).status,404);
    const monitor=await fetch(base+'/api/internal/funding/status',{headers:{Authorization:'Bearer team-secret'}});assert.equal(monitor.status,200);
    assert.doesNotMatch(await monitor.text(),/team-secret/);
    await fetch(base+'/api/funding/interest',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({region:'https://evil.test'})});
    assert.deepEqual(web.status().unsupportedRegions,[]);
  }finally{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});rmSync(dir,{recursive:true,force:true});}
});
