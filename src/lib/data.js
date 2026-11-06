import { formatUnits, getAddress } from 'ethers'
export const normalizeAddress = getAddress
export const short = (s = '') => s ? `${s.slice(0, 6)}…${s.slice(-4)}` : 'Contract creation'
export const amount = (value = '0', decimals = 18) => formatUnits(BigInt(value), Number(decimals))
export const compact = value => { const [a, b] = String(value).split('.'); const fraction = b?.slice(0, 5).replace(/0+$/, ''); return a + (fraction ? '.' + fraction : '') }
export const time = value => value ? new Date(value).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC' : 'Date unavailable / pending'
export async function api(path, signal) {
  let response
  try { response = await fetch('/api/' + path, { signal }) }
  catch (error) { if (error.name === 'AbortError') throw error; throw new Error('Cannot reach the local API. Run npm run dev:all and open its Vite URL.', { cause: error }) }
  let data
  try { data = await response.json() } catch { throw new Error('API proxy is not responding. Keep npm run server running, start npm run dev, and open the printed Vite URL (not a static preview).') }
  if (!response.ok) throw new Error(data.error || 'Request failed.')
  return data
}
export function records(raw, kind, wallet, page = 1) {
  const occurrences = new Map()
  return raw.map((r, index) => {
    const from = (r.from || '').toLowerCase(), to = (r.to || '').toLowerCase(), a = wallet.toLowerCase()
    const fingerprint = [r.hash, r.contractAddress, r.from, r.to, r.value].join(':')
    const occurrence = occurrences.get(fingerprint) || 0
    occurrences.set(fingerprint, occurrence + 1)
    const id = kind === 'normal' ? r.hash : kind === 'internal' ? `${r.hash}:${r.traceId}` : `${r.hash}:${r.logIndex ?? `${page}:${index}:${occurrence}`}`
    const decimals = kind === 'tokens' ? Number(r.tokenDecimal ?? 0) : 18
    const asset = kind === 'tokens' ? (r.tokenSymbol || 'Token') + (r.tokenDecimal == null ? ' (raw units; decimals unavailable)' : '') : 'ETH'
    return { id, hash: r.hash, from: r.from || '', to: r.to || '', date: r.timeStamp == null ? '' : new Date(Number(r.timeStamp) * 1000).toISOString(), direction: from === a && to === a ? 'Self' : from === a ? 'Sent' : 'Received', value: r.value || '0', decimals, asset, contract: r.contractAddress || '', status: r.recordStatus || (r.isError === '1' || r.txreceipt_status === '0' ? 'Failed' : kind === 'tokens' ? 'Indexed' : 'Success'), fee: kind === 'normal' && from === a ? (Object.hasOwn(r, 'feePaid') ? r.feePaid : (BigInt(r.gasUsed || 0) * BigInt(r.gasPrice || 0)).toString()) : null, block: r.blockNumber }
  })
}
export function filterRecords(rows, f) {
  return rows.filter(r => (!f.start || r.date.slice(0, 10) >= f.start) && (!f.end || r.date.slice(0, 10) <= f.end) && (f.direction === 'All' || f.direction === r.direction) && (!f.search || [r.hash, r.from, r.to].some(x => x.toLowerCase().includes(f.search.toLowerCase()))))
}
export function totals(rows) {
  return rows.reduce((t, r) => {
    if (r.asset === 'ETH' && ['Success', 'Indexed'].includes(r.status) && r.direction !== 'Self') t[r.direction === 'Received' ? 'received' : 'sent'] += BigInt(r.value)
    t.fees += BigInt(r.fee || 0)
    return t
  }, { received: 0n, sent: 0n, fees: 0n })
}
