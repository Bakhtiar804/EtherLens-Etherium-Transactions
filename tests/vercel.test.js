import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, get } from 'node:http'
import configHandler from '../api/config.js'
import balanceHandler from '../api/balance.js'
import historyHandler from '../api/history.js'
import detailsHandler from '../api/details.js'

const address='0x0000000000000000000000000000000000000001'
const hash='0x'+'a'.repeat(64)
async function request(handler,path,t){
 const server=createServer(handler)
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 t.after(()=>new Promise(resolve=>server.close(resolve)))
 return new Promise((resolve,reject)=>{get(`http://127.0.0.1:${server.address().port}${path}`,response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode,type:response.headers['content-type'],data:JSON.parse(body)}))}).on('error',reject)})
}
function mockUpstream(t){
 const previous=globalThis.fetch
 globalThis.fetch=async url=>{
  assert.equal(new URL(url).origin,'https://eth-sepolia.blockscout.com')
  const path=new URL(url).pathname
  if(path.endsWith('/transactions')||path.endsWith('/internal-transactions')||path.endsWith('/token-transfers'))return Response.json({items:[],next_page_params:null})
  if(path.includes('/transactions/'))return Response.json({hash,from:{hash:address},to:null,value:'0',block_number:123,status:'ok',fee:{type:'actual',value:'42'}})
  return Response.json({coin_balance:'123456789012345678',block_number_balance_updated_at:123})
 }
 t.after(()=>{globalThis.fetch=previous})
}
test('Vercel config entry serves JSON and defaults to Sepolia',async t=>{
 const r=await request(configHandler,'/api/config',t)
 assert.equal(r.status,200);assert.match(r.type,/json/);assert.equal(r.data.network,'Sepolia Testnet');assert.equal(r.data.history,true)
})
test('Vercel balance function reads the fixed Blockscout upstream',async t=>{
 mockUpstream(t);const r=await request(balanceHandler,'/api/balance?address='+address,t)
 assert.equal(r.status,200);assert.equal(r.data.wei,'123456789012345678');assert.equal(r.data.source,'Blockscout indexed balance')
})
test('Vercel history function returns an empty dataset as JSON',async t=>{
 mockUpstream(t);const r=await request(historyHandler,`/api/history?address=${address}&kind=normal`,t)
 assert.equal(r.status,200);assert.deepEqual(r.data.records,[]);assert.equal(r.data.hasMore,false)
})
test('Vercel details function returns indexed receipt fields',async t=>{
 mockUpstream(t);const r=await request(detailsHandler,'/api/details?hash='+hash,t)
 assert.equal(r.status,200);assert.equal(r.data.fee,'42');assert.equal(r.data.status,'Success')
})
test('serverless API validation errors and unknown routes remain JSON',async t=>{
 assert.equal((await request(balanceHandler,'/api/balance?address=invalid',t)).status,400)
 assert.equal((await request(configHandler,'/api/config?network=bad',t)).status,400)
 const missing=await request(configHandler,'/api/unknown',t)
 assert.equal(missing.status,404);assert.match(missing.data.error,/not found/)
})
