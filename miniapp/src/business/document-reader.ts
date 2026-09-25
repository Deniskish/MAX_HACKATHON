import type { AIDocument } from './ai-client';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import ocrWorker from 'tesseract.js/dist/worker.min.js?url';

export async function readDocument(file: File, progress: (text: string) => void, signal: AbortSignal): Promise<AIDocument> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Выберите файл до 10 МБ.');
  const ext = file.name.toLowerCase().split('.').pop();
  const pages: AIDocument['pages'] = []; let characters = 0;
  let ocr: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | undefined;
  const add = (page: number, text: string) => {
    signal.throwIfAborted(); characters += text.length;
    if (characters > 60000) throw new Error('В документе больше 60 000 символов. Выберите нужные страницы или вставьте фрагмент текста.');
    pages.push({ page, text: text.trim() });
  };
  async function recognize(image: File | HTMLCanvasElement): Promise<string> {
    progress('Распознаём текст на устройстве…');
    const { createWorker } = await import('tesseract.js');
    signal.throwIfAborted();
    ocr ??= await createWorker('rus+eng', 1, { workerPath: ocrWorker, corePath: '/ocr/core', langPath: '/ocr/lang',
      logger: (m) => { if (m.status === 'recognizing text') progress(`Распознаём текст: ${Math.round(m.progress * 100)}%`); } });
    signal.throwIfAborted();
    const { data } = await ocr.recognize(image); return data.text;
  }
  const abort = () => { void ocr?.terminate(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    progress('Читаем документ…'); signal.throwIfAborted();
    if (ext === 'txt') add(1, await file.text());
    else if (ext === 'docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      add(1, result.value);
    } else if (ext === 'pdf') {
      const pdfjs = await import('pdfjs-dist'); pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
      const loading = pdfjs.getDocument({ data: await file.arrayBuffer() });
      const cancelPDF = () => { void loading.destroy(); };
      signal.addEventListener('abort', cancelPDF, { once: true });
      try {
        const pdf = await loading.promise;
        if (pdf.numPages > 40) throw new Error('Для анализа выберите PDF до 40 страниц.');
        let scanPages = 0;
        for (let i = 1; i <= pdf.numPages; i++) {
          signal.throwIfAborted(); progress(`Читаем страницу ${i} из ${pdf.numPages}…`);
          const page = await pdf.getPage(i), content = await page.getTextContent();
          let text = content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('');
          if (text.trim().length < 30) {
            if (++scanPages > 10) throw new Error('В PDF больше 10 сканированных страниц. Разделите файл для распознавания.');
            const viewport = page.getViewport({ scale: Math.min(2, 1800 / page.getViewport({ scale: 1 }).width) });
            const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
            try { await page.render({ canvas, viewport }).promise; text = await recognize(canvas); }
            finally { canvas.width = 0; canvas.height = 0; }
          }
          add(i, text); page.cleanup();
        }
      } finally { signal.removeEventListener('abort', cancelPDF); await loading.destroy(); }
    } else if (['png', 'jpg', 'jpeg', 'webp'].includes(ext ?? '')) {
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 30000000) throw new Error('Изображение слишком большое. Уменьшите его до 30 мегапикселей.');
        const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width * scale; canvas.height = bitmap.height * scale;
        try { canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); add(1, await recognize(canvas)); }
        finally { canvas.width = 0; canvas.height = 0; }
      } finally { bitmap.close(); }
    } else throw new Error('Поддерживаются TXT, PDF, DOCX, PNG и JPG.');
    if (!pages.some((p) => p.text.trim())) throw new Error('Не удалось извлечь текст. Вставьте нужный фрагмент вручную.');
    return { id: crypto.randomUUID(), name: file.name, pages };
  } finally { signal.removeEventListener('abort', abort); await ocr?.terminate(); }
}
