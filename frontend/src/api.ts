let _token = ''

export function setToken(t: string) { _token = t }

async function request(url: string, opts?: RequestInit): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (_token) headers.Authorization = 'Bearer ' + _token
  if (opts?.body) headers['Content-Type'] = 'application/json'
  const r = await fetch(url, { ...opts, headers: { ...headers, ...opts?.headers } })
  const text = await r.text()
  let data: Record<string, unknown> = {}
  try { data = JSON.parse(text) } catch { throw new Error(text) }
  if (!r.ok) throw new Error((data.error as string) || text || `HTTP ${r.status}`)
  return data
}

export const api = (url: string) => request(url) as Promise<Record<string, unknown>>

export const apiJSON = (url: string, body: unknown, method = 'POST') =>
  request(url, { method, body: JSON.stringify(body) }) as Promise<Record<string, unknown>>

export const apiDelete = (url: string) =>
  request(url, { method: 'DELETE' }) as Promise<Record<string, unknown>>

export function proxyImg(url?: string): string {
  if (!url) return ''
  if (/no-?poster/i.test(url)) return ''
  return '/proxy?url=' + encodeURIComponent(url)
}
