import { networks } from '../lib/networks'
import { useEffect, useRef, useState } from 'react'
import { X, Copy, ExternalLink } from 'lucide-react'
import { api, amount, time } from '../lib/data'
export default function Details({ row, close, copy, network }) {
  const dialog = useRef(null)
  const [rpc, setRpc] = useState(null), [error, setError] = useState('')
  useEffect(() => {
    dialog.current.showModal()
    const c = new AbortController()
    api(`details?network=${network}&hash=${row.hash}`, c.signal).then(setRpc).catch(e => { if (!c.signal.aborted) setError(e.message) })
    return () => c.abort()
  }, [row.hash, network])
  const fields = [['Hash', row.hash], ['From', row.from], ['To', row.to || 'Contract creation'], ['Date', time(row.date)], ['Direction', row.direction], ['Indexed amount', `${amount(row.value, row.decimals)} ${row.asset}`], ['Token contract', row.contract || 'Not applicable'], ['Status', rpc?.status || row.status], ['Block', rpc?.block || row.block], ['Fee paid by transaction sender', rpc?.fee ? `${amount(rpc.fee)} ETH` : row.fee !== null ? `${amount(row.fee)} ETH` : 'Unavailable / not attributed in this dataset']]
  return <dialog ref={dialog} onCancel={close} onClick={e => { if (e.target === dialog.current) close() }}><div className="section-heading"><h2>Transaction details</h2><button aria-label="Close details" onClick={close}><X size={20}/></button></div><p className="muted">{network === 'sepolia' ? 'Blockscout indexed transfer and transaction details' : 'Indexed transfer values and live RPC receipt'}</p>{error && <p className="notice">{error} Indexed fields remain available.</p>}<dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}<button aria-label={`Copy ${label}`} onClick={() => copy(String(value))}><Copy size={13}/></button></dd></div>)}</dl><a className="primary button" href={`${networks[network].explorer}/tx/${row.hash}`} target="_blank" rel="noreferrer">View on Etherscan <ExternalLink size={15}/></a></dialog>
}
