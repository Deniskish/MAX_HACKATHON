// Читаем ответ провайдера с ограничением размера, не сохраняя его в логах.
export async function providerJson(response: Response, maxBytes = 128000): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('INVALID_PROVIDER_RESPONSE');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('RESPONSE_TOO_LARGE');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('INVALID_PROVIDER_RESPONSE');
  }
}
