import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, ExternalLink, RefreshCw, Wallet } from 'lucide-react'
import { formatEther, formatUnits, getAddress } from 'ethers'
import { browserWallet, prepareTransfer, readTransferBalance, submitTransfer, transferError, transferReceiptStatus, validateTransfer, SEPOLIA_CHAIN_ID, USDC_ADDRESS } from '../lib/transfers'

const explorer = 'https://sepolia.etherscan.io/tx/'
const emptyBalance = { data: null, loading: false, error: '' }
export default function SendTransfer({ onConfirmed }) {
  const [recipient, setRecipient] = useState(''), [ethAmount, setEthAmount] = useState('')
  const [asset, setAsset] = useState('ETH'), [balanceVersion, setBalanceVersion] = useState(0)
  const [balanceView, setBalanceView] = useState(emptyBalance)
  const [wallet, setWallet] = useState(null), [chainId, setChainId] = useState(null)
  const [review, setReview] = useState(null), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const [transaction, setTransaction] = useState(null)
  const lock = useRef(false), generation = useRef(0), currentWallet = useRef(null)
  const confirmedCallback = useRef(onConfirmed)
  const injectedWallet = wallet?.injected
  useEffect(() => { confirmedCallback.current = onConfirmed }, [onConfirmed])
  useEffect(() => {
    let cancelled = false
    async function load() {
      setBalanceView({ data: null, loading: !!wallet && chainId === SEPOLIA_CHAIN_ID, error: '' })
      if (!wallet || chainId !== SEPOLIA_CHAIN_ID) return
      try {
        const data = await readTransferBalance({ ...wallet, asset })
        if (!cancelled && currentWallet.current === wallet) setBalanceView({ data, loading: false, error: '' })
      } catch (e) { if (!cancelled && currentWallet.current === wallet) setBalanceView({ data: null, loading: false, error: transferError(e) }) }
    }
    load()
    return () => { cancelled = true }
  }, [wallet, chainId, asset, balanceVersion])
  useEffect(() => {
    if (!injectedWallet) return
    const changed = () => {
      generation.current++
      setReview(null); setWallet(null); currentWallet.current = null; setChainId(null)
      setBalanceView(emptyBalance)
      setError('Wallet account or network changed. Connect again to use the current account.')
    }
    const accountChanged = accounts => {
      const connection = currentWallet.current
      if (connection?.injected !== injectedWallet) return
      if (!accounts?.length) { changed(); return }
      const account = getAddress(accounts[0])
      if (account === connection.account) return
      const next = { ...connection, account }
      generation.current++
      currentWallet.current = next
      setWallet(next)
      setReview(null)
      setBalanceView(emptyBalance)
      setError('')
    }
    injectedWallet.on?.('accountsChanged', accountChanged)
    injectedWallet.on?.('chainChanged', changed)
    injectedWallet.on?.('disconnect', changed)
    return () => {
      injectedWallet.removeListener?.('accountsChanged', accountChanged)
      injectedWallet.removeListener?.('chainChanged', changed)
      injectedWallet.removeListener?.('disconnect', changed)
    }
  }, [injectedWallet])
  useEffect(() => () => { generation.current++ }, [])

  async function run(label, action) {
    if (lock.current) return
    lock.current = true; setBusy(label); setError('')
    try { await action() } catch (e) { setError(transferError(e)) }
    finally { lock.current = false; setBusy('') }
  }
  async function connect() {
    await run('Connecting…', async () => {
      const injected = window.ethereum
      const provider = browserWallet(injected)
      const accounts = await injected.request({ method: 'eth_requestAccounts' })
      if (!accounts?.length) throw new Error('No account was shared by your wallet.')
      const chain = BigInt(await injected.request({ method: 'eth_chainId' }))
      const next = { injected, provider, account: getAddress(accounts[0]) }
      generation.current++; currentWallet.current = next
      setWallet(next); setChainId(chain); setReview(null)
    })
  }
  async function changeWallet() {
    await run('Choosing account…', async () => {
      const { injected, provider } = wallet
      setReview(null)
      generation.current++
      try {
        await injected.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
      } catch (e) {
        if ([-32601, 4200].includes(e?.code)) {
          setError('Choose another account in your wallet extension. This page will update when the wallet shares the new account.')
          return
        }
        if (e?.code === 4001) {
          setError('Wallet change cancelled.')
          return
        }
        throw e
      }
      const version = generation.current
      const [accounts, chain] = await Promise.all([
        injected.request({ method: 'eth_accounts' }),
        injected.request({ method: 'eth_chainId' }),
      ])
      if (version !== generation.current) return
      if (!accounts?.length) {
        disconnect()
        setError('No account was shared. Connect your wallet again to continue.')
        return
      }
      const next = { injected, provider, account: getAddress(accounts[0]) }
      currentWallet.current = next
      setWallet(next)
      setChainId(BigInt(chain))
      setBalanceView(emptyBalance)
    })
  }
  async function switchNetwork() {
    await run('Switching network…', async () => {
      await wallet.injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })
      // A chainChanged event invalidates the connection. Reconnect after switching.
      setReview(null); setWallet(null); currentWallet.current = null; setChainId(null)
      setError('Sepolia selected. Connect your wallet again to continue.')
    })
  }
  function disconnect() {
    generation.current++; currentWallet.current = null
    setWallet(null); setChainId(null); setReview(null); setError('')
  }
  async function prepare(e) {
    e.preventDefault()
    await run('Estimating fee…', async () => {
      validateTransfer(recipient, ethAmount, asset)
      if (!wallet) throw new Error('Connect your wallet first. The searched explorer address cannot sign transactions.')
      const g = generation.current
      const next = await prepareTransfer({ ...wallet, recipient, ethAmount, asset })
      if (g !== generation.current) throw new Error('Wallet changed during preparation. Connect and review again.')
      setReview(next)
    })
  }
  function showReceipt(receipt, hash, transfer) {
    const status = transferReceiptStatus(receipt, transfer)
    setTransaction({ hash, status, block: receipt?.blockNumber, review: transfer })
    if (receipt) setBalanceVersion(n => n + 1)
    if (status === 'confirmed') confirmedCallback.current?.()
  }
  async function send() {
    if (!review || !wallet) return
    await run('Confirm in wallet…', async () => {
      const connection = wallet
      const tx = await submitTransfer({ ...connection, review })
      setReview(null); setTransaction({ hash: tx.hash, status: 'pending', review }); setBusy('Waiting for confirmation…')
      try { showReceipt(await tx.wait(1, 120000), tx.hash, review) }
      catch (e) {
        if (e.code === 'TRANSACTION_REPLACED') {
          setTransaction({ hash: e.replacement?.hash || tx.hash, status: 'replaced', review })
          setError('This transaction was replaced or cancelled in the wallet. Inspect its explorer link before starting another transfer.')
        } else if (e.receipt) showReceipt(e.receipt, tx.hash, review)
        else { setTransaction({ hash: tx.hash, status: 'pending', review }); setError('Transaction was submitted, but confirmation could not be verified yet. Check its status below; do not submit it again.') }
      }
    })
  }
  async function checkStatus() {
    await run('Checking status…', async () => {
      const connection = currentWallet.current
      if (!connection) throw new Error('Connect your wallet to check confirmation, or use the explorer link.')
      if (BigInt(await connection.injected.request({ method: 'eth_chainId' })) !== SEPOLIA_CHAIN_ID) throw new Error('Switch your wallet to Sepolia to check this transaction.')
      showReceipt(await connection.provider.getTransactionReceipt(transaction.hash), transaction.hash, transaction.review)
    })
  }
  const pending = transaction?.status === 'pending' || transaction?.status === 'unverified'
  return <section id="send" className="panel send-panel">
    <div className="section-heading"><div><div className="eyebrow">SEPOLIA TESTNET</div><h2>Send ETH or USDC</h2><p>Select an asset, enter a recipient and amount. Your wallet reviews and signs.</p></div><span className="send-badge"><Wallet size={15}/> Wallet signed</span></div>
    <div className="send-connection">{wallet ? <>
      <div><small>Sending account</small><code>{wallet.account}</code></div>
      <div className="wallet-actions">
        <button type="button" disabled={!!busy} onClick={changeWallet}>{busy === 'Choosing account…' ? busy : 'Change wallet'}</button>
        <button type="button" disabled={!!busy} onClick={disconnect}>Disconnect</button>
      </div>
    </> : <><p>Connect MetaMask or an Ethereum browser wallet to send Sepolia ETH or test USDC.</p><button type="button" className="primary" disabled={!!busy} onClick={connect}><Wallet size={16}/>{busy === 'Connecting…' ? busy : 'Connect wallet'}</button></>}</div>
    {wallet && chainId !== SEPOLIA_CHAIN_ID && <div className="send-warning"><span>Your wallet is on a different network. This form sends on Sepolia only.</span><button type="button" disabled={!!busy} onClick={switchNetwork}>Switch wallet to Sepolia</button></div>}
    <form onSubmit={prepare} className="send-form">
      <label htmlFor="send-asset">Asset<select id="send-asset" value={asset} disabled={!!busy || pending} onChange={e => { setAsset(e.target.value); setEthAmount(''); setReview(null); setError('') }}><option value="ETH">Ethereum (ETH)</option><option value="USDC">USD Coin (USDC)</option></select></label>
      <label htmlFor="recipient">Recipient address<input id="recipient" autoComplete="off" spellCheck="false" placeholder="0x…" value={recipient} disabled={!!busy || pending} onChange={e => { setRecipient(e.target.value); setReview(null); setError('') }}/></label>
      <label htmlFor="send-amount">Amount ({asset})<input id="send-amount" inputMode="decimal" autoComplete="off" placeholder={asset === 'USDC' ? '10.00' : '0.001'} value={ethAmount} disabled={!!busy || pending} onChange={e => { setEthAmount(e.target.value); setReview(null); setError('') }}/></label>
      <button className="primary" type="submit" disabled={!!busy || pending || !wallet || chainId !== SEPOLIA_CHAIN_ID}>{busy || 'Review transfer'}<ArrowUpRight size={16}/></button>
    </form>
    <div className="send-balances" aria-live="polite"><span>{balanceView.loading ? 'Reading wallet balance…' : balanceView.data ? `Wallet balance: ${formatUnits(balanceView.data.balance, balanceView.data.decimals)} ${asset}` : `Connect on Sepolia to read your ${asset} balance.`}</span>{asset === 'USDC' && balanceView.data && <span>Gas balance: {formatEther(balanceView.data.ethBalance)} ETH</span>}{wallet && chainId === SEPOLIA_CHAIN_ID && <button type="button" aria-label="Refresh sending wallet balance" disabled={!!busy || balanceView.loading} onClick={() => setBalanceVersion(n => n + 1)}><RefreshCw size={13}/> Refresh balance</button>}</div>
    {balanceView.error && <p className="send-error error" role="alert">{balanceView.error}</p>}
    {asset === 'USDC' && <p className="send-token-note">Circle Sepolia test USDC · 6 decimals · Gas is paid in ETH.<br/><a href={`https://sepolia.etherscan.io/token/${USDC_ADDRESS}`} target="_blank" rel="noreferrer">Contract: {USDC_ADDRESS} <ExternalLink size={12}/></a></p>}
    {review && <div className="transfer-review"><h3>Review your transfer</h3><dl><div><dt>Network</dt><dd>Sepolia Testnet · chain 11155111</dd></div><div><dt>From</dt><dd>{review.account}</dd></div><div><dt>Recipient</dt><dd>{review.recipient}</dd></div><div><dt>Amount</dt><dd>{formatUnits(review.assetAmount, review.decimals)} {review.asset} (Sepolia testnet)</dd></div><div><dt>Estimated maximum fee</dt><dd>{formatEther(review.maxFee)} test ETH</dd></div><div><dt>{review.asset === 'USDC' ? 'Maximum ETH for gas' : 'Maximum total ETH debit'}</dt><dd>{formatEther(review.total)} test ETH</dd></div>{review.asset === 'USDC' && <div><dt>USDC token contract</dt><dd>{USDC_ADDRESS}</dd></div>}</dl><p>Actual gas usage may be lower. Your wallet shows the final transaction and fee. USDC sends call transfer directly; no token spending approval is requested.</p><div className="send-actions"><button disabled={!!busy} type="button" onClick={() => setReview(null)}>Edit transfer</button><button disabled={!!busy} type="button" className="primary" onClick={send}>{busy || 'Confirm in wallet'}</button></div></div>}
    {error && <p className="send-error error" role="alert">{error}</p>}
    {transaction && <div className="transfer-result" role="status"><strong>{transaction.status === 'confirmed' ? <><Check size={17}/> Transfer confirmed</> : transaction.status === 'failed' ? 'Transaction failed on-chain; network fees may still apply.' : transaction.status === 'replaced' ? 'Transaction replaced / cancelled' : transaction.status === 'unverified' ? 'Transaction mined; USDC transfer event could not be verified. Check the explorer.' : 'Transaction submitted · pending confirmation'}</strong><span>{formatUnits(transaction.review.assetAmount, transaction.review.decimals)} {transaction.review.asset} → {transaction.review.recipient}</span><a href={explorer + transaction.hash} target="_blank" rel="noreferrer">{transaction.hash} <ExternalLink size={14}/></a>{transaction.block && <small>Mined in block {transaction.block}. Explorer history may take a moment to update.</small>}<div className="send-actions">{pending ? <button type="button" disabled={!!busy} onClick={checkStatus}><RefreshCw size={14}/> Check confirmation</button> : <button type="button" disabled={!!busy} onClick={() => { setTransaction(null); setRecipient(''); setEthAmount(''); setError('') }}>New transfer</button>}</div></div>}
    <p className="send-footnote">This form sends Sepolia ETH and Circle Sepolia test USDC. Both are testnet assets; USDC gas fees are paid in ETH. The explorer search address and connected sending account are independent. Private keys stay in your wallet.</p>
  </section>
}
