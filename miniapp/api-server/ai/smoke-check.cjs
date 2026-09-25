// Запускается после развёртывания. Никаких ключей, промптов и ответов модели в логах.
(async () => {
  const base = process.env.OPORA_CHECK_URL || 'http://localhost:3002';
  const status = await (await fetch(base + '/api/ai/status')).json();
  console.log('AI configuration:', JSON.stringify({ configured: status.configured, status: status.status, model: status.model }));
  const response = await fetch(base + '/api/ai/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'workspace', question: 'Проанализируй имеющиеся сведения и адаптируй все пять разделов. Верни personalization. Не придумывай параметры бизнеса: если данных мало, предложи уточнения.', context: { profile: {}, workspace: { savedIds: [], applications: [] } } }), signal: AbortSignal.timeout(70000) });
  if (!response.ok) throw new Error('AI_ENDPOINT_FAILED');
  const result = await response.json();
  if (!['llm', 'local'].includes(result.mode) || typeof result.answer !== 'string' || !Array.isArray(result.actions)) throw new Error('AI_CONTRACT_FAILED');
  console.log('AI smoke:', JSON.stringify({ mode: result.mode, tools: result.tools, usage: result.usage, providerFailure: result.providerFailure }));
  console.log('AI adaptation:', JSON.stringify({ sections: Object.keys(result.personalization?.sections || {}), priorities: result.personalization?.priorities?.length ?? 0 }));
  if (result.mode === 'llm' && !['home', 'programs', 'applications', 'calendar', 'assistant'].every((page) => result.personalization?.sections?.[page])) throw new Error('AI_ADAPTATION_FAILED');
  if (status.configured && result.mode !== 'llm') console.warn('AI_PROVIDER_NOT_READY: endpoint works, live provider requires attention.');
  const chatResponse = await fetch(base + '/api/ai/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: 'chat', question: 'Что мне подходит?', context: {
      profile: { companyType: 'АО', applicantType: 'legal_entity', region: 'Чувашская Республика', okved: '10.82.2', isSme: 'unknown' },
      need: { purpose: 'запуск производства', amount: 400000, preferredTermMonths: 3, ownFunds: null, needsCollateralSupport: null },
    } }), signal: AbortSignal.timeout(70000) });
  if (!chatResponse.ok) throw new Error('AI_CHAT_ENDPOINT_FAILED');
  const chat = await chatResponse.json();
  console.log('AI chat:', JSON.stringify({ mode: chat.mode, usage: chat.usage, providerFailure: chat.providerFailure,
    answerLength: chat.answer?.length, duplicateNeed: !!chat.proposedNeed, actions: chat.actions?.map((a) => a.programId) }));
  if (status.configured && chat.mode !== 'llm') throw new Error('AI_CHAT_PROVIDER_NOT_READY');
  if (chat.proposedNeed || chat.actions?.some((a) => a.programId && !chat.matches?.some((m) => m.id === a.programId && !['not_eligible', 'expired', 'upcoming'].includes(m.status)))) throw new Error('AI_CHAT_RECOMMENDATIONS_FAILED');
  const sources = await fetch(base + '/api/funding/updates');
  if (!sources.ok) throw new Error('SOURCE_ENDPOINT_FAILED');
})().catch((e) => { console.error(e.name === 'TimeoutError' ? 'AI_CHECK_TIMEOUT' : e.message); process.exitCode = 1; });
