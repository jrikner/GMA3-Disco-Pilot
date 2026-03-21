export function getAppAssetUrl(pathname = '') {
  const normalizedPath = String(pathname || '').replace(/^\/+/, '')
  const baseHref = typeof document !== 'undefined' && document.baseURI
    ? document.baseURI
    : (typeof window !== 'undefined' ? window.location.href : 'http://localhost/')

  return new URL(normalizedPath, baseHref).href
}
