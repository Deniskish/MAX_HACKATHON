import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { ModalSheet } from './ModalSheet';
import { GlassArt } from './GlassArt';

type ChatMessage = { role: 'user' | 'assistant'; text: string };

export function AssistantPage({ businessName, status, messages, renderMessage, question, onQuestion, sending, onSend, onStop, onBack, onClear, context, program }: {
  businessName: string; status: string; messages: ChatMessage[]; renderMessage: (index: number) => ReactNode;
  question: string; onQuestion: (text: string) => void; sending: boolean; onSend: (text: string) => void;
  onStop: () => void; onBack: () => void; onClear: () => void; context: (close: () => void) => ReactNode;
  program?: { title: string; onOpen: () => void; onRemove: () => void };
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const scrollHeight = useRef(0);
  const latest = () => {
    const element = scroll.current;
    if (element) element.scrollTop = element.scrollHeight;
    pinned.current = true;
    setAwayFromBottom(false);
  };
  useLayoutEffect(() => {
    if (pinned.current || messages.at(-1)?.role === 'user') latest();
  }, [messages, sending]);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 112)}px`;
  }, [question]);
  useLayoutEffect(() => {
    if (!scroll.current) return;
    scrollHeight.current = scroll.current.clientHeight;
    const observer = new ResizeObserver(() => {
      scrollHeight.current = scroll.current?.clientHeight ?? 0;
      if (pinned.current) latest();
    });
    observer.observe(scroll.current);
    return () => observer.disconnect();
  }, []);
  function send(text = question) {
    if (!text.trim() || sending) return;
    pinned.current = true;
    onSend(text);
  }
  return <section className="assistant-page" aria-label="Чат с AI-помощником">
    <header className="assistant-header">
      <button className="assistant-icon-button assistant-back" aria-label="В мой бизнес" onClick={onBack}><Icon name="chevron" /></button>
      <div className="assistant-heading"><h1>Опора AI</h1><span title={businessName}>{businessName}</span></div>
      <button className="assistant-icon-button" aria-label="О чате и контексте бизнеса" onClick={() => setInfoOpen(true)}><Icon name="spark" /></button>
    </header>
    {program && <div className="assistant-program">
      <button onClick={program.onOpen}><Icon name="file" size={17} /><span>{program.title}</span></button>
      <button aria-label="Перейти к общим вопросам" onClick={program.onRemove}><Icon name="close" size={18} /></button>
    </div>}
    <div className="assistant-conversation">
      <div className="assistant-messages" ref={scroll} role="log" aria-label="Переписка" aria-live="polite" onScroll={() => {
        const element = scroll.current!;
        if (element.clientHeight !== scrollHeight.current) return;
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64;
        setAwayFromBottom(!pinned.current);
      }}>
        {!messages.some((message) => message.role === 'user') && <div className="assistant-welcome">
          <GlassArt shape="loop" size={112} className="assistant-welcome-art" />
          <h2>С чего начнём?</h2><p>Помогу найти поддержку и разобраться с документами для вашего бизнеса.</p>
          <div className="assistant-prompts">{['Что мне подходит?', 'Какой следующий шаг?', 'Какие документы нужны?'].map((text) => <button key={text} disabled={sending} onClick={() => send(text)}>{text}<Icon name="arrow" size={16} /></button>)}</div>
        </div>}
        {messages.map((message, index) => <article key={index} className={`message ${message.role}`} aria-label={message.role === 'user' ? 'Вы' : 'Опора AI'}>{renderMessage(index)}</article>)}
        {sending && <div className="assistant-typing" role="status"><span />Готовлю ответ…</div>}
      </div>
      {awayFromBottom && <button className="assistant-latest" onClick={latest}>К последним сообщениям ↓</button>}
    </div>
    <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); send(); }}>
      <div className="assistant-input-wrap">
        <textarea ref={input} rows={1} aria-label="Сообщение помощнику" placeholder="Спросите о поддержке бизнеса…" maxLength={2000} value={question}
          onChange={(event) => onQuestion(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
          }} />
        {sending ? <button type="button" className="assistant-send" aria-label="Остановить ответ" onClick={onStop}><span className="assistant-stop-symbol" /></button>
          : <button type="submit" className="assistant-send" aria-label="Отправить сообщение" disabled={!question.trim()} onMouseDown={(event) => event.preventDefault()}><Icon name="arrow" /></button>}
      </div>
      <small>Важные условия проверяйте в официальном источнике</small>
    </form>
    {infoOpen && <ModalSheet title="О чате" onClose={() => setInfoOpen(false)}>
      <div className="assistant-info"><h2>Помощник вашего бизнеса</h2><p>{status}</p>{context(() => setInfoOpen(false))}
        <button className="assistant-clear" onClick={() => { onClear(); setInfoOpen(false); pinned.current = true; }}>Очистить историю чата</button>
      </div>
    </ModalSheet>}
  </section>;
}
