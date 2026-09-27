import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createApp, type AIClient } from './app';
import { NotificationStore } from './funding-catalog/notifications';
import { OporaAPI } from '../../chatbot/src/api-client';
import { Conversation, type Reply } from '../../chatbot/src/conversation';
const token = 'test-bot-service-token';
async function fixture(run: (url: string, one: OporaAPI, two: OporaAPI) => Promise<void>, giga: AIClient | null = null) {
  const store = new NotificationStore(':memory:');
  const server = createApp({ notifications: store, giga, env: { BOT_TOKEN: token } }).listen(0,'127.0.0.1');
  await new Promise<void>(resolve => server.once('listening',resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  try { await run(url,new OporaAPI(url,token,'101'),new OporaAPI(url,token,'202')); }
  finally { await new Promise<void>(resolve => {server.close(()=>resolve());server.closeAllConnections();});store.db.close(); }
}
test('bot account needs service authentication, shares MAX identity, and isolates persisted conversations', async () => fixture(async(url,one,two)=>{
  assert.equal((await fetch(url+'/api/bot/workspace')).status,401);
  assert.equal((await fetch(url+'/api/account',{headers:{'X-Opora-Bot-User':'101'}})).status,401);
  const account = await one.request<any>('GET','/api/account');
  assert.equal(account.identity,'max');assert.equal(account.canSubmitApplications,false);
  await one.request('PUT','/api/bot/workspace',{revision:0,data:{version:1,history:['private']}});
  assert.deepEqual((await two.request<any>('GET','/api/bot/workspace')).data,{});
  await assert.rejects(()=>one.request('PUT','/api/bot/workspace',{revision:0,data:{history:['overwrite']}}),{status:409});
  assert.deepEqual((await one.request<any>('GET','/api/bot/workspace')).data.history,['private']);
  const company={inn:'7707083893',name:'Компания',region:'Москва',okved:'28.99',isSme:'yes'};
  await one.request('PUT','/api/account/company',{revision:account.revision,company});
  const params=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:101})});
  const key=createHmac('sha256','WebAppData').update(token).digest();
  params.set('hash',createHmac('sha256',key).update([...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex'));
  const shared=await (await fetch(url+'/api/account',{headers:{'X-Max-Init-Data':params.toString()}})).json();
  assert.equal(shared.id,account.id);assert.equal(shared.company.inn,company.inn);
  assert.equal((await two.request<any>('GET','/api/account')).company,null);
  await one.request('DELETE','/api/account/company');
  assert.deepEqual((await one.request<any>('GET','/api/bot/workspace')).data,{});
}));
test('service signatures bind user, path, body, time and nonce; replay is rejected', async()=>fixture(async(url)=>{
  const route='/api/bot/workspace', timestamp=String(Date.now()), nonce=randomUUID();
  const key=createHmac('sha256',token).update('opora-bot-api-v1').digest();
  const signature=createHmac('sha256',key).update(['GET',route,'101',timestamp,nonce,'{}'].join('\n')).digest('hex');
  const headers={'X-Opora-Bot-User':'101','X-Opora-Bot-Time':timestamp,'X-Opora-Bot-Nonce':nonce,'X-Opora-Bot-Signature':signature};
  assert.equal((await fetch(url+route,{headers:{...headers,'X-Opora-Bot-User':'202'}})).status,401);
  assert.equal((await fetch(url+'/api/account',{headers})).status,401);
  assert.equal((await fetch(url+route,{headers:{...headers,'X-Opora-Bot-Time':String(Date.now()-120000)}})).status,401);
  assert.equal((await fetch(url+route,{headers})).status,200);
  assert.equal((await fetch(url+route,{headers})).status,401);
  const writeNonce=randomUUID(), body={revision:0,data:{text:'original'}};
  const signed=createHmac('sha256',key).update(['PUT',route,'101',timestamp,writeNonce,JSON.stringify(body)].join('\n')).digest('hex');
  const writeHeaders={...headers,'Content-Type':'application/json','X-Opora-Bot-Nonce':writeNonce,'X-Opora-Bot-Signature':signed};
  assert.equal((await fetch(url+route,{method:'PUT',headers:writeHeaders,body:JSON.stringify({...body,data:{text:'changed'}})})).status,401);
  assert.equal((await fetch(url+route,{method:'PUT',headers:writeHeaders,body:JSON.stringify(body)})).status,200);
}));
test('bot subscriptions use the existing account and reject oversized state',async()=>fixture(async(_url,one,two)=>{
  await one.request('PUT','/api/notifications/subscription',{profile:{region:'Москва',okved:'28.99'},need:{purpose:'покупка оборудования'},bot:true});
  assert.equal((await one.request<any>('GET','/api/notifications')).bot,true);
  assert.equal((await two.request<any>('GET','/api/notifications')).bot,false);
  await one.request('DELETE','/api/notifications/subscription');
  assert.equal((await one.request<any>('GET','/api/notifications')).bot,false);
  await one.request('PUT','/api/bot/workspace',{revision:0,data:{text:'я'.repeat(60000)}});
  await assert.rejects(()=>one.request('PUT','/api/bot/workspace',{revision:1,data:{text:'a'.repeat(81000)}}),{status:400});
}));
test('chat journeys run through the real authenticated API, catalogue and AI validation',async()=>{
  const tasks:string[]=[];
  await fixture(async(_url,api)=>{
    let sequence=0;
    const send=async(input:{text?:string;action?:string})=>await new Conversation(api,'https://business-opora.ru').handle({id:String(++sequence),...input}) as Reply;
    assert.match((await send({text:'Как найти поддержку?'})).text,/Ответ/);
    await api.request('PUT','/api/account/company',{revision:0,company:{inn:'7707083893',name:'Мастерская',region:'Москва',okved:'28.99',isSme:'yes'}});
    await send({action:'find'});await send({action:'purpose:0'});
    const results=await send({text:'100 млн'});assert.match(results.text,/Варианты/);
    const detail=await send({action:'open:frp-development'});assert.match(detail.text,/ФРП/);
    await send({action:'explain:frp-development'});
    await send({action:'prepare:frp-development'});
    assert.match((await send({text:'Закупка станков за три месяца.'})).text,/Черновик/);
    await send({action:'review:frp-development'});await send({text:'Смета: оборудование 100 млн рублей.'});
    assert.deepEqual(tasks,['chat','chat','draft','review']);
    assert.match((await send({action:'export:frp-development'})).file!.text,/Заявка не отправлена/);
  },{async complete(){return {answer:'Ответ',mode:'llm'};},async assist(input:any){tasks.push(input.task);return {mode:'llm',answer:'Ответ с проверкой условий.',draft:input.task==='draft'?'Описание проекта.':undefined,followups:[],citations:[],actions:[],findings:[],matches:[],scenarios:[],tools:[]};}});
});
