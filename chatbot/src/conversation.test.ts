import test from 'node:test';
import assert from 'node:assert/strict';
import { Conversation, parseAmount, quickNeed, type Reply } from './conversation';
import { APIError, type BotAPI } from './api-client';
import { splitText, createHandler, deliver } from './transport';
import { readFile, access } from 'node:fs/promises';
import type { Context } from '@maxhub/max-bot-api';

const company = { inn:'7707083893', name:'Мастерская', region:'Москва', okved:'28.99', isSme:'yes' };
const opportunity = {id:'frp-development',title:'Проекты развития',providerName:'ФРП',description:'Развитие производства',amountMin:100000000,amountMax:1000000000,deadline:null,status:'active',requiredDocuments:['Бизнес-план'],source:{name:'ФРП',url:'https://frprf.ru/'}};
class FakeAPI implements BotAPI {
  data: any = {}; revision=0; account: any={company:null,revision:0}; bot=false;
  calls: {method:string;route:string;body:any}[]=[]; failAI=false;
  async request<T=any>(method:string,route:string,body?:any):Promise<T> {
    this.calls.push({method,route,body});
    let result:any;
    if(route==='/api/bot/workspace') {
      if(method==='PUT') {assert.equal(body.revision,this.revision);this.data=structuredClone(body.data);this.revision++;}
      result={data:structuredClone(this.data),revision:this.revision};
    } else if(route==='/api/account') result=structuredClone(this.account);
    else if(route==='/api/account/company') {
      if(method==='PUT') {assert.equal(body.revision,this.account.revision);this.account={company:body.company,revision:this.account.revision+1};}
      else {this.account={company:null,revision:this.account.revision+1};this.data={};this.revision++;this.bot=false;}
      result=structuredClone(this.account);
    } else if(route.startsWith('/api/company/')) result={profile:company};
    else if(route==='/api/funding/catalog') result={opportunities:[opportunity]};
    else if(route==='/api/funding/match') result={matches:[{opportunity,status:'need_more_data',explanation:'Уточните условия'}]};
    else if(route==='/api/ai/assist') {if(this.failAI)throw new APIError(503,'AI_UNAVAILABLE');result={mode:'llm',answer:'Проверьте условия у оператора.',draft:body.task==='draft'?'Проект: новая линия производства.':undefined};}
    else if(route==='/api/notifications') result={bot:this.bot};
    else if(route==='/api/notifications/subscription') {this.bot=method==='PUT';result={bot:this.bot};}
    else throw Error(route);
    return result;
  }
}
function session(api=new FakeAPI()) {
  let i=0;
  const send=(text:string)=>new Conversation(api,'https://business-opora.ru').handle({id:'msg-'+(++i),text}) as Promise<Reply>;
  const click=(action:string)=>new Conversation(api,'https://business-opora.ru').handle({id:'cb-'+(++i),action}) as Promise<Reply>;
  return {api,send,click};
}
const action=(r:Reply,label:string)=>r.buttons.flat().find(b=>b.text===label)!.action!;

test('guest starts without a password or company and can immediately ask AI',async()=>{
  const {send,api}=session();
  const menu=await send('/start');assert.match(menu.text,/Что нужно/);assert.doesNotMatch(menu.text,/парол/i);
  const result=await send('Как зарегистрировать ИП?');assert.match(result.text,/оператора/);
  assert.equal(api.calls.find(c=>c.route==='/api/ai/assist')?.body.context.profile,undefined);
});
test('company confirmation, short selection, saved programme and state survive a new controller',async()=>{
  const {send,click,api}=session();
  await click('find');const found=await send(company.inn);
  assert.equal(api.account.company,null,'lookup does not save without consent');
  await click(action(found,'Добавить компанию'));assert.equal(api.account.company.inn,company.inn);
  await click('purpose:0');const list=await send('100 млн');assert.match(list.text,/Проекты развития/);
  assert.equal(api.data.need.amount,100000000);
  await click('open:frp-development');await click('save:frp-development');
  assert.match((await click('saved')).text,/Проекты развития/);
  const match=api.calls.find(c=>c.route==='/api/funding/match');assert.equal(match?.body.profile.inn,company.inn);
});
test('one-line task keeps amount when company is added',async()=>{
  const {send,click,api}=session();await send('Нужно 5 млн на оборудование');
  assert.equal(api.data.need.amount,5000000);
  const found=await send(company.inn);const list=await click(action(found,'Добавить компанию'));
  assert.match(list.text,/Варианты/);assert.equal(api.data.need.amount,5000000);
});
test('project can use matching without inventing a registered company',async()=>{
  const {send,click,api}=session();await click('find');await click('project');await send('Чувашская Республика');await send('Производство мебели');
  await click('purpose:0');await click('amount:skip');
  const match=api.calls.find(c=>c.route==='/api/funding/match');assert.equal(match?.body.profile.applicantType,'project');assert.equal(api.account.company,null);
});

test('a ten-digit amount is treated as financing, not a company INN',async()=>{
  const {send,click,api}=session();api.account.company=company;
  await click('find');await click('purpose:0');await send('1000000000');
  assert.equal(api.data.need.amount,1000000000);
  assert.equal(api.calls.some(c=>c.route.startsWith('/api/company/')),false);
  await click('save:frp-development');
  assert.match((await send('/calendar')).text,/Проекты развития/);
});
test('AI failure keeps the task and retry works; duplicate MAX event does not repeat AI',async()=>{
  const {send,click,api}=session();api.failAI=true;assert.match((await send('Как начать?')).text,/повторить/);
  assert.match((await click('retry')).text,/повторить/);
  api.failAI=false;assert.match((await click('retry')).text,/оператора/);
  const event={id:'stable-event',text:'Что дальше?'};
  await new Conversation(api,'https://business-opora.ru').handle(event);
  const count=api.calls.filter(c=>c.route==='/api/ai/assist').length;
  assert.equal(await new Conversation(api,'https://business-opora.ru').handle(event),null);
  assert.equal(api.calls.filter(c=>c.route==='/api/ai/assist').length,count);
});
test('draft is persisted, exported and submitted only via official source',async()=>{
  const {send,click,api}=session();await click('prepare:frp-development');
  const result=await send('Новая линия за три месяца.');assert.match(result.text,/Черновик/);assert.doesNotMatch(result.text,/Заявка принята/);
  assert.equal(result.buttons.flat().find(b=>b.text==='Подать на сайте оператора')?.url,opportunity.source.url);
  const exported=await click('export:frp-development');assert.match(exported.file!.text,/Заявка не отправлена/);
  assert.equal(api.data.drafts.length,1);
  await click('remove-draft:frp-development');assert.equal(api.data.drafts.length,0);
});
test('review sends actual document text and company switches clear the old context',async()=>{
  const {send,click,api}=session();api.account.company=company;
  await click('review:frp-development');await send('Стоимость оборудования — 100 млн рублей.');
  const review=api.calls.find(c=>c.body?.task==='review');assert.match(review?.body.context.documents[0].pages[0].text,/100 млн/);
  api.account.company={...company,inn:'500100732259'};
  await click('chat');assert.equal(api.data.history.length,0);assert.equal(api.data.selected,undefined);
});
test('subscriptions are opt-in and deleting the business clears chat state',async()=>{
  const {send,click,api}=session();api.account.company=company;await send('/start');assert.equal(api.bot,false);
  const prompt=await click('notifications');await click(action(prompt,'Включить'));assert.equal(api.bot,true);
  const confirm=await click('delete');await click(action(confirm,'Удалить'));
  assert.equal(api.bot,false);assert.equal(api.account.company,null);assert.deepEqual(api.data.history,[]);
  assert.match((await click(action(confirm,'Удалить'))).text,/не актуально/);
});
test('amounts and fast task parsing reject malformed and unsafe values',()=>{
  assert.equal(parseAmount('5 млн'),5000000);assert.equal(parseAmount('1,5 млн'),1500000);assert.equal(parseAmount('500 000 ₽'),500000);
  for(const value of ['-5 млн','ноль','9999999999999999999','1.001 млн'])assert.equal(parseAmount(value),null);
  assert.equal(quickNeed('Нужно 5 млн на оборудование')?.amount,5000000);
  assert.equal(quickNeed('Как работает субсидия?'),null);
});
test('transport ignores group messages and bot senders without accessing API',async()=>{
  const handler=createHandler('test','http://127.0.0.1:1','https://business-opora.ru');
  await handler({user:{user_id:101,is_bot:false},message:{recipient:{chat_type:'chat'}}} as Context);
  await handler({user:{user_id:101,is_bot:true}} as Context);
  const chunks=splitText('а'.repeat(2999)+'😀'+'б'.repeat(3002));
  assert.ok(chunks.every(c=>c.length<=3000));assert.equal(chunks.join(''),'а'.repeat(2999)+'😀'+'б'.repeat(3002));
});

test('delivery splits answers, keeps controls on the last part and cleans exported files',async()=>{
  const sent:{user:number;text:string;options:any}[]=[];
  let uploadedPath='';
  const ctx={api:{
    async sendMessageToUser(user:number,text:string,options:any){sent.push({user,text,options});},
    async uploadFile({source}:{source:string}){
      uploadedPath=source;assert.equal(await readFile(source,'utf8'),'Текст черновика');
      return {toJson:()=>({type:'file',payload:{token:'controlled-upload'}})};
    },
  }} as unknown as Context;
  await deliver(ctx,101,{text:'а'.repeat(3500),buttons:[[{text:'Меню',action:'menu'}]],file:{name:'opora-draft.txt',text:'Текст черновика'}});
  assert.equal(sent.length,3);assert.ok(sent.every(m=>m.user===101));
  assert.equal(sent[0].options.attachments,undefined);
  assert.equal(sent[1].options.attachments[0].type,'inline_keyboard');
  assert.equal(sent[2].options.attachments[0].type,'file');
  await assert.rejects(access(uploadedPath));
});
