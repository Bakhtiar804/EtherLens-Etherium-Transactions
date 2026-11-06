import { networks } from './networks.js'
import { amount, totals } from './data.js'
export const csvCell = v => '"' + String(v ?? '').replace(/^[\s]*[=+@-]/, x => "'" + x).replaceAll('"', '""') + '"'
export function statementMeta({ address, kind, filters, balance, coverage, rows, network = 'mainnet' }) {
  const t = totals(rows)
  return [
    ['EtherLens statement', 'PARTIAL — loaded records only'], ['Wallet', address], ['Network', networks[network].label + ' (chain ' + networks[network].chainId + ')'], ['Dataset', kind],
    ['Date range UTC', `${filters.start || 'Unbounded'} to ${filters.end || 'Unbounded'}`], ['Direction filter', filters.direction], ['Search filter', filters.search || 'None'],
    ['Generated UTC', new Date().toISOString()], ['Current balance ETH (not period activity)', balance ? amount(balance.wei) : 'Unavailable'], ['Balance observed UTC', balance?.observedAt || 'Unavailable'],
    ['Received ETH (loaded filtered records)', kind === 'tokens' ? 'Not applicable: separate token assets' : amount(t.received)], ['Sent ETH (loaded filtered records)', kind === 'tokens' ? 'Not applicable: separate token assets' : amount(t.sent)], ['Paid fees ETH (normal dataset only)', kind === 'normal' ? amount(t.fees) : 'Not included; see normal transactions'],
    ['Source', networks[network].historySource + '; balance: ' + (balance?.source || 'ethers v6 / configured Ethereum RPC')], ['Balance indexed / observed block', balance?.block ?? 'Unavailable'], ['Coverage', coverage], ['Exclusions', 'Not a complete lifetime ledger; excludes other datasets, NFTs and beacon withdrawals. Token transfers are not holdings.'], ['Row count', rows.length],
  ]
}
export const headers = ['Hash', 'Date UTC', 'From', 'To', 'Direction', 'Amount', 'Asset', 'Token contract', 'Status', 'Paid fee ETH', 'Block']
export const statementRows = rows => rows.map(r => [r.hash, r.date, r.from, r.to || 'Contract creation', r.direction, amount(r.value, r.decimals), r.asset, r.contract, r.status, r.fee === null ? 'Not attributed' : amount(r.fee), r.block])
export async function downloadStatement(format, options, returnDocument = false) {
  const meta = statementMeta(options), body = statementRows(options.rows)
  const name = `EtherLens-${options.network || 'mainnet'}-${options.kind}-partial-${new Date().toISOString().slice(0, 10)}`
  if (format === 'csv') {
    const blob = new Blob(['\uFEFF' + [...meta, [], headers, ...body].map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  } else {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
    doc.setFontSize(22); doc.text('EtherLens / Wallet statement', 14, 18)
    autoTable(doc, { startY: 25, body: meta, styles: { fontSize: 8, overflow: 'linebreak' }, columnStyles: { 0: { cellWidth: 72 } }, theme: 'striped' })
    autoTable(doc, { startY: doc.lastAutoTable.finalY + 10, head: [headers], body, showHead: 'everyPage', styles: { fontSize: 6.5, overflow: 'linebreak', cellPadding: 2 }, headStyles: { fillColor: [83, 63, 165] }, columnStyles: { 0: { cellWidth: 48 }, 2: { cellWidth: 44 }, 3: { cellWidth: 44 }, 7: { cellWidth: 44 } }, didDrawPage: () => { doc.setFontSize(8); doc.text(`Partial statement · UTC · Page ${doc.internal.getNumberOfPages()}`, 14, 290) } })
    if (returnDocument) return doc
    doc.save(name + '.pdf')
  }
}
