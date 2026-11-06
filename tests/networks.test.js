import test from 'node:test'
import assert from 'node:assert/strict'
import { networks, validNetwork, resolveNetwork } from '../src/lib/networks.js'
import { statementMeta } from '../src/lib/statements.js'
test('network selections and statements distinguish Sepolia from Mainnet',()=>{assert.equal(validNetwork('sepolia'),'sepolia');assert.equal(validNetwork('bad'),'mainnet');assert.equal(networks.sepolia.chainId,11155111);assert.equal(networks.sepolia.explorer,'https://sepolia.etherscan.io');const meta=statementMeta({address:'0x1',kind:'normal',network:'sepolia',filters:{direction:'All'},rows:[],coverage:'Empty loaded dataset'});assert.match(meta.find(([k])=>k==='Network')[1],/Sepolia.*11155111/);assert.notEqual(networks.mainnet.explorer,networks.sepolia.explorer)})
test('plain URLs default to Sepolia, remember explicit choices and respect shared links',()=>{
  assert.equal(resolveNetwork(null, null), 'sepolia')
  assert.equal(resolveNetwork(null, 'mainnet'), 'mainnet')
  assert.equal(resolveNetwork('sepolia', 'mainnet'), 'sepolia')
  assert.equal(resolveNetwork('mainnet', 'sepolia'), 'mainnet')
  assert.equal(resolveNetwork('invalid', 'invalid'), 'sepolia')
})
