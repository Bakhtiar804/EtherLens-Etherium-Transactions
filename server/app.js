import express from 'express'
import rateLimit from 'express-rate-limit'
import { JsonRpcProvider, FetchRequest, getAddress } from 'ethers'
import { blockscout, blockscoutHistory } from './blockscout.js'
import { DEFAULT_NETWORK } from '../src/lib/networks.js'

const app = express()
app.disable('x-powered-by')
// Vercel terminates the public connection before forwarding to this function.
if (process.env.VERCEL === '1') app.set('trust proxy', 1)
app.use('/api', rateLimit({ windowMs: 60000, limit: 90, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please wait a minute.' } }))
const networks = {
  mainnet: { id: 1, label: 'Ethereum Mainnet', env: 'ETH_RPC_URL', url: process.env.ETH_RPC_URL?.trim() },
  sepolia: { id: 11155111, label: 'Sepolia Testnet', env: 'SEPOLIA_RPC_URL', url: process.env.SEPOLIA_RPC_URL?.trim() },
}
// Alchemy uses the same app key across enabled networks. Explicit configuration wins.
if (!networks.sepolia.url && networks.mainnet.url) {
  try { const u = new URL(networks.mainnet.url); if (u.hostname === 'eth-mainnet.g.alchemy.com') { u.hostname = 'eth-sepolia.g.alchemy.com'; networks.sepolia.url = u.href } } catch { /* Invalid URLs are reported below. */ }
}
for (const n of Object.values(networks)) {
  if (!n.url) continue
  try {
    const url = new URL(n.url)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid protocol')
    const request = new FetchRequest(n.url); request.timeout = 15000
    n.provider = new JsonRpcProvider(request, n.id, { staticNetwork: true })
  } catch { n.error = n.env + ' must be a full HTTPS RPC URL, not just an API key.' }
}
function network(req) {
  const name = req.query.network || DEFAULT_NETWORK
  if (!Object.hasOwn(networks, name)) fail('Unsupported network.', 400)
  return networks[name]
}
async function rpc(req) {
  const n = network(req)
  if (n.error) fail(n.error, 503)
  if (!n.provider) fail('Setup required: configure ' + n.env + ' for ' + n.label + ' in .env.', 503)
  if (BigInt(await n.provider.send('eth_chainId', [])) !== BigInt(n.id)) fail('RPC network mismatch: expected ' + n.label + ' (chain ' + n.id + ').', 503)
  return n.provider
}
let queue = Promise.resolve()
let lastRequest = 0
const route = fn => async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try { await fn(req, res) } catch (e) {
    const status = Number(e.status || e.info?.responseStatus || 502)
    const message = e.publicMessage || (status === 401 || status === 403 ? 'RPC access denied. Check the key in ETH_RPC_URL and enable the selected network in your provider dashboard.' : e.code === 'TIMEOUT' || e.name === 'TimeoutError' ? 'RPC request timed out. Try again or check your provider.' : 'Data provider unavailable. Check server configuration or try again shortly.')
    res.status(status >= 400 && status <= 599 ? status : 502).json({ error: message })
  }
}
function fail(message, status = 400) { throw Object.assign(new Error(message), { publicMessage: message, status }) }
function address(req) { try { return getAddress(req.query.address) } catch { fail('Enter a valid Ethereum address.') } }
app.get('/api/config', route(async (req, res) => { const n = network(req); const sepolia = n.id === 11155111; res.json({ rpc: sepolia || !!n.provider, history: sepolia || !!process.env.ETHERSCAN_API_KEY, chainId: n.id, network: n.label, source: sepolia ? 'Blockscout Sepolia API v2' : 'Etherscan V2 / RPC' }) }))
app.get('/api/balance', route(async (req, res) => {
  const a = address(req)
  if (network(req).id === 11155111) {
    const data = await blockscout(`/addresses/${a}`)
    if (!/^\d+$/.test(String(data.coin_balance))) fail('Blockscout has not indexed a balance for this address yet.', 502)
    return res.json({ wei: data.coin_balance, block: data.block_number_balance_updated_at, observedAt: new Date().toISOString(), source: 'Blockscout indexed balance' })
  }
  const provider = await rpc(req)
  const block = await provider.getBlockNumber()
  const balance = await provider.getBalance(a, block)
  res.json({ wei: balance.toString(), block, observedAt: new Date().toISOString() })
}))
app.get('/api/details', route(async (req, res) => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(req.query.hash || '')) fail('Invalid transaction hash.')
  if (network(req).id === 11155111) {
    const tx = await blockscout(`/transactions/${req.query.hash}`)
    return res.json({ from: tx.from?.hash, to: tx.to?.hash, value: tx.value, nonce: tx.nonce, status: tx.status === 'error' ? 'Failed' : tx.block_number == null ? 'Pending' : 'Success', fee: tx.fee?.type === 'actual' ? tx.fee.value : null, block: tx.block_number, source: 'Blockscout indexed transaction' })
  }
  const provider = await rpc(req)
  const [tx, receipt] = await Promise.all([provider.getTransaction(req.query.hash), provider.getTransactionReceipt(req.query.hash)])
  if (!tx) fail('Transaction not found.', 404)
  res.json({ from: tx.from, to: tx.to, value: tx.value.toString(), nonce: tx.nonce, status: receipt ? (receipt.status === 1 ? 'Success' : 'Failed') : 'Pending', fee: receipt?.fee.toString(), block: receipt?.blockNumber })
}))
app.get('/api/history', route(async (req, res) => {
  const a = address(req)
  const n = network(req)
  const actions = { normal: 'txlist', internal: 'txlistinternal', tokens: 'tokentx' }
  const action = actions[req.query.kind]
  const page = Number(req.query.page || 1)
  if (!action || !Number.isInteger(page) || page < 1 || page > 100) fail('Invalid dataset or page (maximum 100).')
  if (n.id === 11155111) return res.json(await blockscoutHistory(a, req.query.kind, req.query.cursor, page))
  if (!process.env.ETHERSCAN_API_KEY) fail('Setup required: configure ETHERSCAN_API_KEY in .env.', 503)
  const job = queue.catch(() => {}).then(async () => {
    await new Promise(r => setTimeout(r, Math.max(0, 550 - (Date.now() - lastRequest))))
    lastRequest = Date.now()
    const url = new URL('https://api.etherscan.io/v2/api')
    url.search = new URLSearchParams({ chainid: String(n.id), module: 'account', action, address: a, startblock: '0', endblock: '9999999999', page: String(page), offset: '100', sort: 'desc', apikey: process.env.ETHERSCAN_API_KEY })
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) fail(response.status === 429 ? 'Etherscan rate limit reached. Try again shortly.' : 'Etherscan is unavailable.', response.status === 429 ? 429 : 502)
    const data = await response.json()
    if (data.status === '0' && /no transactions found/i.test(String(data.result) + data.message)) return []
    if (data.status !== '1' || !Array.isArray(data.result)) {
      const message = String(data.result || '')
      fail(/rate limit/i.test(message) ? 'Etherscan rate limit reached. Try again shortly.' : /key|plan|subscription/i.test(message) ? 'Etherscan configuration or plan does not permit this request. Check your API key and plan.' : 'Etherscan could not return history. Retry later.', /rate limit/i.test(message) ? 429 : 502)
    }
    return data.result
  })
  queue = job
  const records = await job
  res.json({ records, hasMore: records.length === 100, page })
}))
app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found.' }))
export default app
