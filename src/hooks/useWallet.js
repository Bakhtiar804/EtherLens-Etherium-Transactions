import { useEffect, useRef, useState } from 'react'
import { api, records } from '../lib/data'
export default function useWallet(address, kind, refresh, network) {
  const [balance, setBalance] = useState(null)
  const [history, setHistory] = useState({ rows: [], page: 0, hasMore: false, nextCursor: null })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const controller = useRef(null)
  useEffect(() => {
    const c = new AbortController(); controller.current = c
    const g = ++generation.current
    const run = async () => {
      setBalance(null); setHistory({ rows: [], page: 0, hasMore: false, nextCursor: null }); setErrors({})
      if (!address) { setLoading(false); return }
      setLoading(true)
      await Promise.allSettled([
        api(`balance?network=${network}&address=${address}`, c.signal).then(d => { if (!c.signal.aborted) setBalance(d) }).catch(e => { if (!c.signal.aborted) setErrors(v => ({ ...v, balance: e.message })) }),
        api(`history?network=${network}&address=${address}&kind=${kind}&page=1`, c.signal).then(d => { if (!c.signal.aborted) setHistory({ rows: records(d.records, kind, address), page: 1, hasMore: d.hasMore, nextCursor: d.nextCursor || null }) }).catch(e => { if (!c.signal.aborted) setErrors(v => ({ ...v, history: e.message })) }),
      ])
      if (generation.current === g) setLoading(false)
    }
    run()
    return () => c.abort()
  }, [address, kind, refresh, network])
  async function more() {
    const g = generation.current
    setLoading(true)
    try {
      const d = await api(`history?network=${network}&address=${address}&kind=${kind}&page=${history.page + 1}&cursor=${encodeURIComponent(history.nextCursor || '')}`, controller.current.signal)
      if (g !== generation.current) return
      setHistory(h => ({ rows: [...new Map([...h.rows, ...records(d.records, kind, address, d.page)].map(r => [r.id, r])).values()], page: d.page, hasMore: d.hasMore, nextCursor: d.nextCursor || null }))
      setErrors(v => ({ ...v, history: null }))
    } catch (e) { if (g === generation.current && e.name !== 'AbortError') setErrors(v => ({ ...v, history: e.message })) }
    finally { if (g === generation.current) setLoading(false) }
  }
  return { balance, history, errors, loading, more }
}
