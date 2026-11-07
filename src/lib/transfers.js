import { BrowserProvider, Contract, Interface, getAddress, parseUnits, ZeroAddress } from 'ethers'

export const SEPOLIA_CHAIN_ID = 11155111n
// Circle's official Ethereum Sepolia USDC deployment; not a user-supplied token.
export const USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
export const USDC_ABI = [
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]
export const USDC_INTERFACE = new Interface(USDC_ABI)
export const transferAssets = { ETH: { decimals: 18, label: 'Ethereum (ETH)' }, USDC: { decimals: 6, label: 'USD Coin (USDC)' } }
function assetDetails(asset) {
  if (!Object.hasOwn(transferAssets, asset)) throw new Error('Choose ETH or USDC.')
  return transferAssets[asset]
}
export function validateTransfer(recipient, ethAmount, asset = 'ETH') {
  const { decimals } = assetDetails(asset)
  let to
  try { to = getAddress(recipient.trim()) } catch { throw new Error('Enter a valid recipient Ethereum address.') }
  if (to === ZeroAddress) throw new Error('The zero address cannot be used as a recipient.')
  const text = ethAmount.trim()
  const pattern = new RegExp(`^(?:\\d+(?:\\.\\d{1,${decimals}})?|\\.\\d{1,${decimals}})$`)
  if (!pattern.test(text)) throw new Error(`Enter a positive ${asset} amount with up to ${decimals} decimal places.`)
  const value = parseUnits(text, decimals)
  if (value <= 0n) throw new Error('Amount must be greater than zero.')
  return { to, value }
}
export function browserWallet(injected) {
  if (!injected?.request) throw new Error('Open this site in a browser with MetaMask or another Ethereum wallet extension installed.')
  return new BrowserProvider(injected, 'any', { cacheTimeout: -1 })
}
export async function verifyWallet(injected, expectedAccount) {
  if (BigInt(await injected.request({ method: 'eth_chainId' })) !== SEPOLIA_CHAIN_ID) throw new Error('Switch your wallet to Sepolia Testnet before continuing.')
  const accounts = await injected.request({ method: 'eth_accounts' })
  if (!accounts?.length || getAddress(accounts[0]) !== getAddress(expectedAccount)) throw new Error('The wallet account changed or disconnected. Reconnect and review again.')
}
async function readUsdc(provider, account) {
  const token = new Contract(USDC_ADDRESS, USDC_ABI, provider)
  const code = await provider.getCode(USDC_ADDRESS)
  if (!code || code === '0x') throw new Error('USDC contract was not found on this wallet network.')
  const [decimals, balance] = await Promise.all([token.decimals(), token.balanceOf(account)])
  if (decimals !== 6n) throw new Error('Unexpected USDC decimals. Please check the selected network and RPC.')
  return { token, balance }
}
export async function readTransferBalance({ injected, provider, account, asset = 'ETH' }) {
  const { decimals } = assetDetails(asset)
  await verifyWallet(injected, account)
  const [ethBalance, usdc] = await Promise.all([provider.getBalance(account, 'pending'), asset === 'USDC' ? readUsdc(provider, account) : null])
  await verifyWallet(injected, account)
  return { asset, balance: usdc ? usdc.balance : ethBalance, ethBalance, decimals }
}
export async function prepareTransfer({ injected, provider, account, recipient, ethAmount, asset = 'ETH' }) {
  const { to, value } = validateTransfer(recipient, ethAmount, asset)
  await verifyWallet(injected, account)
  let payload = { to, value }
  if (asset === 'USDC') {
    const { token, balance } = await readUsdc(provider, account)
    if (balance < value) throw new Error('Insufficient Sepolia USDC for this transfer.')
    if (!await token.transfer.staticCall(to, value, { from: account })) throw new Error('USDC transfer simulation returned false. The transfer cannot proceed.')
    payload = { ...await token.transfer.populateTransaction(to, value), value: 0n }
  }
  const base = { ...payload, from: getAddress(account), chainId: SEPOLIA_CHAIN_ID }
  const [estimatedGas, fees, balance] = await Promise.all([
    provider.estimateGas(base), provider.getFeeData(), provider.getBalance(account, 'pending'),
  ])
  const gasLimit = (estimatedGas * 120n + 99n) / 100n
  let pricing
  if (fees.maxFeePerGas != null && fees.maxPriorityFeePerGas != null) pricing = { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }
  else if (fees.gasPrice != null) pricing = { gasPrice: fees.gasPrice }
  else throw new Error('Your wallet RPC could not estimate network fees. Try again.')
  const maxFee = gasLimit * (pricing.maxFeePerGas ?? pricing.gasPrice)
  const total = (asset === 'ETH' ? value : 0n) + maxFee
  if (balance < total) throw new Error(asset === 'USDC' ? 'Insufficient Sepolia ETH for gas. USDC transfers also need ETH to pay network fees.' : 'Insufficient Sepolia ETH for the amount plus the estimated maximum network fee.')
  await verifyWallet(injected, account)
  return { request: { ...base, gasLimit, ...pricing }, asset, recipient: to, assetAmount: value, decimals: assetDetails(asset).decimals, maxFee, total, account: getAddress(account) }
}
export async function submitTransfer({ injected, provider, review }) {
  await verifyWallet(injected, review.account)
  const balance = await provider.getBalance(review.account, 'pending')
  if (balance < review.total) throw new Error('Your balance changed. Review again; there is not enough Sepolia ETH including fees.')
  if (review.asset === 'USDC') {
    const { token, balance: tokenBalance } = await readUsdc(provider, review.account)
    if (tokenBalance < review.assetAmount) throw new Error('Your USDC balance changed. Review again; there is not enough USDC.')
    if (!await token.transfer.staticCall(review.recipient, review.assetAmount, { from: review.account })) throw new Error('USDC transfer simulation returned false. Review again.')
  }
  await verifyWallet(injected, review.account)
  const signer = await provider.getSigner(review.account)
  if (getAddress(await signer.getAddress()) !== review.account) throw new Error('The wallet account changed. Reconnect and review again.')
  // Both from and chainId stay explicit. The wallet shows the final signing prompt.
  return signer.sendTransaction(review.request)
}
export function transferReceiptStatus(receipt, review) {
  if (!receipt) return 'pending'
  if (receipt.status !== 1) return 'failed'
  if (review.asset !== 'USDC') return 'confirmed'
  const found = receipt.logs?.some(log => {
    if (log.address?.toLowerCase() !== USDC_ADDRESS.toLowerCase()) return false
    try {
      const event = USDC_INTERFACE.parseLog(log)
      return event?.name === 'Transfer' && event.args.from.toLowerCase() === review.account.toLowerCase() && event.args.to.toLowerCase() === review.recipient.toLowerCase() && event.args.value === review.assetAmount
    } catch { return false }
  })
  return found ? 'confirmed' : 'unverified'
}
export function transferError(error) {
  const code = error?.code ?? error?.info?.error?.code
  if (code === 4001 || code === 'ACTION_REJECTED') return 'Request cancelled in your wallet. No new transaction was submitted by this action.'
  if (code === -32002) return 'A wallet request is already open. Complete or close it in your wallet.'
  if (code === 'INSUFFICIENT_FUNDS') return 'Insufficient Sepolia ETH for the amount and network fee.'
  if (code === 'CALL_EXCEPTION') return 'The recipient transaction would fail. Check the address, amount and any contract requirements.'
  return error?.shortMessage || error?.message || 'The wallet request failed. Please try again.'
}
