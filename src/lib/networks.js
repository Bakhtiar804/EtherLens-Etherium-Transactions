export const networks = {
  mainnet: { label: 'Ethereum Mainnet', explorer: 'https://etherscan.io', chainId: 1, historySource: 'Etherscan V2' },
  sepolia: { label: 'Sepolia Testnet', explorer: 'https://sepolia.etherscan.io', chainId: 11155111, historySource: 'Blockscout Sepolia API v2' },
}
export const validNetwork = value => Object.hasOwn(networks, value) ? value : 'mainnet'
export const DEFAULT_NETWORK = 'sepolia'
export function resolveNetwork(queryNetwork, savedNetwork) {
  if (Object.hasOwn(networks, queryNetwork)) return queryNetwork
  if (Object.hasOwn(networks, savedNetwork)) return savedNetwork
  return DEFAULT_NETWORK
}
export function readNetwork(search) {
  let saved
  try { saved = localStorage.getItem('etherlens-network') } catch { /* Storage may be disabled. */ }
  return resolveNetwork(new URLSearchParams(search).get('network'), saved)
}
export function rememberNetwork(network) {
  try { localStorage.setItem('etherlens-network', network) } catch { /* The selector still works without storage. */ }
}
