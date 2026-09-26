export function maxInitData() {
  // Use the original launch payload; never build a signature from initDataUnsafe.
  return new URLSearchParams(window.location.hash.slice(1)).get('WebAppData') || window.WebApp?.initData || '';
}
