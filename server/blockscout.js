// The user-selected instance is fixed; callers cannot supply an upstream URL.
const BASE = 'https://eth-sepolia.blockscout.com/api/v2'
const paths = { normal: 'transactions', internal: 'internal-transactions', tokens: 'token-transfers' }
let queue = Promise.resolve()
let lastRequest = 0
function error(message, status = 502) { return Object.assign(new Error(message), { publicMessage: message, status }) }
export async function blockscout(path, params = {}) {
  const job = queue.catch(() => {}).then(async () => {
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 550 - (Date.now() - lastRequest))))
    lastRequest = Date.now()
    const url = new URL(BASE + path)
    url.search = new URLSearchParams(params)
    let response
    try { response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' }) }
    catch (cause) { throw Object.assign(error('Blockscout Sepolia is unreachable or timed out. Please retry.'), { cause }) }
    if (!response.ok) throw error(response.status === 429 ? 'Blockscout rate limit reached. Wait a moment and retry.' : response.status === 404 ? 'Blockscout has not indexed this address or transaction yet.' : 'Blockscout Sepolia is unavailable. Please retry.', response.status === 429 ? 429 : response.status === 404 ? 404 : 502)
    try { return await response.json() } catch (cause) { throw Object.assign(error('Blockscout returned an invalid response.'), { cause }) }
  })
  queue = job
  return job
}
const cursorKeys = new Set(['block_number', 'index', 'items_count', 'transaction_index', 'log_index', 'batch_log_index', 'batch_key', 'batch_block_hash', 'batch_transaction_hash', 'hash', 'value', 'fee', 'inserted_at'])
export function cursorParams(cursor, address, kind) {
  if (!cursor) return {}
  try {
    if (typeof cursor !== 'string' || cursor.length > 4096 || !/^[\w-]+$/.test(cursor)) throw new Error('Invalid cursor')
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (parsed.address !== address.toLowerCase() || parsed.kind !== kind || !parsed.params || Array.isArray(parsed.params)) throw new Error('Cursor mismatch')
    for (const [key, value] of Object.entries(parsed.params)) {
      if (!cursorKeys.has(key) || !(value === null || (key === 'inserted_at' ? /^\d{4}-\d{2}-\d{2}T[\d:.]{8,20}Z$/.test(String(value)) : /^(?:\d{1,80}|0x[\da-fA-F]{64})$/.test(String(value))))) throw new Error('Invalid cursor parameter')
    }
    return Object.fromEntries(Object.entries(parsed.params).filter(([, value]) => value !== null))
  } catch (cause) { throw Object.assign(error('Invalid history cursor. Refresh this wallet to restart pagination.', 400), { cause }) }
}
export function nextCursor(params, address, kind) {
  if (!params || !Object.keys(params).length) return null
  const encoded = Buffer.from(JSON.stringify({ address: address.toLowerCase(), kind, params })).toString('base64url')
  cursorParams(encoded, address, kind)
  return encoded
}
export function normalizeBlockscout(item, kind) {
  const failed = item.status === 'error' || item.success === false || !!item.error
  const pending = kind === 'normal' && item.block_number == null
  const date = item.timestamp ? new Date(item.timestamp) : null
  return {
    hash: item.hash || item.transaction_hash,
    from: item.from?.hash || '', to: item.to?.hash || '',
    value: kind === 'tokens' ? item.total?.value : item.value || '0',
    timeStamp: date && !Number.isNaN(date.getTime()) ? String(Math.floor(date.getTime() / 1000)) : null,
    blockNumber: item.block_number == null ? '' : String(item.block_number),
    isError: failed ? '1' : '0',
    recordStatus: failed ? 'Failed' : pending ? 'Pending' : kind === 'tokens' ? 'Indexed' : 'Success',
    feePaid: kind === 'normal' && item.fee?.type === 'actual' ? item.fee.value : null,
    traceId: item.index == null ? undefined : String(item.index),
    logIndex: item.log_index == null ? undefined : String(item.log_index),
    contractAddress: kind === 'tokens' ? item.token?.address_hash || '' : item.created_contract?.hash || '',
    tokenDecimal: kind === 'tokens' ? item.total?.decimals ?? item.token?.decimals : undefined,
    tokenSymbol: item.token?.symbol || 'Token',
  }
}
export async function blockscoutHistory(address, kind, cursor, page) {
  const params = cursorParams(cursor, address, kind)
  if (page > 1 && !cursor) throw error('A cursor is required to load the next Blockscout page.', 400)
  const data = await blockscout(`/addresses/${address}/${paths[kind]}`, { ...params, ...(kind === 'tokens' ? { type: 'ERC-20' } : {}) })
  if (!Array.isArray(data.items)) throw error('Blockscout returned an invalid history response.')
  const items = kind === 'tokens' ? data.items.filter(item => (item.token?.type || item.token_type) === 'ERC-20') : data.items
  for (const item of items) {
    const decimals = item.total?.decimals ?? item.token?.decimals
    if (kind === 'tokens' && (!/^\d+$/.test(String(item.total?.value)) || (decimals != null && (!/^\d+$/.test(String(decimals)) || Number(decimals) > 255)))) throw error('Blockscout token amount metadata is invalid. Retry later.')
  }
  const next = nextCursor(data.next_page_params, address, kind)
  return { records: items.map(item => normalizeBlockscout(item, kind)), nextCursor: next, hasMore: !!next, page, source: 'Blockscout Sepolia API v2' }
}
