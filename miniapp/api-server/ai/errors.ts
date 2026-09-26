/** Only stable public codes may leave the provider boundary. Never expose messages. */
export function providerFailureCode(error: unknown): string {
  const value = error as { code?: unknown; message?: unknown; name?: unknown } | null;
  if (value?.name === 'TimeoutError' || value?.name === 'AbortError') return 'PROVIDER_TIMEOUT';
  const code = typeof value?.code === 'string' ? value.code : value?.message;
  return typeof code === 'string' && /^(PROVIDER_HTTP_\d{3}|PROVIDER_TIMEOUT|PROVIDER_RATE_LIMITED|PROVIDER_UNAVAILABLE|PROVIDER_CONTENT_BLOCKED|TRUNCATED_RESPONSE|INVALID_RESPONSE|NO_FUNCTION_CALL|GIGACHAT_AUTH_FAILED)$/.test(code)
    ? code : 'PROVIDER_UNAVAILABLE';
}

export function providerFailureReason(code: string) {
  if (code === 'PROVIDER_CONTENT_BLOCKED') return 'request_rejected';
  if (code === 'PROVIDER_TIMEOUT') return 'timeout';
  if (code === 'PROVIDER_RATE_LIMITED' || code === 'PROVIDER_HTTP_429') return 'rate_limit';
  if (['TRUNCATED_RESPONSE', 'INVALID_RESPONSE', 'NO_FUNCTION_CALL'].includes(code)) return 'invalid_response';
  if (code === 'GIGACHAT_AUTH_FAILED' || code === 'PROVIDER_HTTP_401') return 'authentication';
  return 'provider';
}
