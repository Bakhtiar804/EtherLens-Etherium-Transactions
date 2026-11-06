import { amount, compact, totals } from '../lib/data'
export default function ActivityChart({ rows, kind }) {
  const grouped = new Map()
  rows.forEach(r => { if (!r.date) return; const d = r.date.slice(0, 10); grouped.set(d, [...(grouped.get(d) || []), r]) })
  const days = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([date, records]) => ({ date, ...totals(records) }))
  const max = days.reduce((a, d) => [a, d.received, d.sent].reduce((x, y) => x > y ? x : y), 1n)
  return <section className="panel chart-panel"><div className="section-heading"><div><h2>Transfer activity</h2><p>ETH movement · loaded, filtered {kind} records · UTC</p></div><div className="legend"><span className="green">● Received</span><span className="violet">● Sent</span></div></div>
    {kind === 'tokens' || !days.length ? <div className="chart-empty"><div className="grid-lines"/><span>{kind === 'tokens' ? 'Choose an ETH dataset to view transfer activity' : 'Your activity will take shape here'}<small>{kind === 'tokens' ? 'Different token assets are never added together.' : 'Search a public wallet to explore its on-chain movement.'}</small></span></div> : <><div className="chart-bars">{days.map(d => <div className="bar-group" key={d.date} title={`${d.date}: Received ${amount(d.received)} ETH; Sent ${amount(d.sent)} ETH`}><div className="bar received" style={{ height: `${Number(d.received * 10000n / max) / 100}%` }}/><div className="bar sent" style={{ height: `${Number(d.sent * 10000n / max) / 100}%` }}/><span className="sr-only">{d.date} received {amount(d.received)}, sent {amount(d.sent)}</span></div>)}</div><div className="chart-labels"><span>{days[0].date}</span><span>Daily volume · max {compact(amount(max))} ETH</span><span>{days.at(-1).date}</span></div></>}
  </section>
}
