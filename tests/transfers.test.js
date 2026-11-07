import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEther } from 'ethers'
import { browserWallet, validateTransfer, verifyWallet, prepareTransfer, submitTransfer, transferError } from '../src/lib/transfers.js'
const account='0x0000000000000000000000000000000000000001'
const to='0x0000000000000000000000000000000000000002'
function connection({balance=parseEther('1'),chain='0xaa36a7',accounts=[account]}={}){
 const sent=[]
 const injected={request:async({method})=>{if(method==='eth_chainId')return chain;if(method==='eth_accounts')return accounts;throw new Error('Unexpected wallet method')}}
 const provider={estimateGas:async()=>21000n,getFeeData:async()=>({maxFeePerGas:2000000000n,maxPriorityFeePerGas:1000000000n}),getBalance:async()=>balance,getSigner:async()=>({getAddress:async()=>account,sendTransaction:async request=>{sent.push(request);return{hash:'mock-transaction-hash'}}})}
 return{injected,provider,account,sent}
}
test('transfer input keeps exact wei and rejects invalid/zero address and invalid amounts',()=>{
 assert.equal(validateTransfer(to,'0.000000000000000001').value,1n)
 assert.equal(validateTransfer(to,'.01').value,parseEther('.01'))
 for(const text of ['0','-1','1e3','NaN','1,2','0.0000000000000000001','Infinity'])assert.throws(()=>validateTransfer(to,text))
 assert.throws(()=>validateTransfer('bad','1'));assert.throws(()=>validateTransfer('0x'+'0'.repeat(40),'1'))
 assert.throws(()=>browserWallet(null),/wallet extension/)
})
test('review shows exact maximum fee and total, with Sepolia and sender pinned',async()=>{
 const c=connection();const review=await prepareTransfer({...c,recipient:to,ethAmount:'.01'})
 assert.equal(review.request.chainId,11155111n);assert.equal(review.request.from,account);assert.equal(review.request.to,to)
 assert.equal(review.request.gasLimit,25200n);assert.equal(review.maxFee,50400000000000n);assert.equal(review.total,parseEther('.01')+review.maxFee)
 assert.equal(c.sent.length,0)
})
test('insufficient amount plus fee is blocked before a wallet signing request',async()=>{
 const c=connection({balance:parseEther('.01')})
 await assert.rejects(()=>prepareTransfer({...c,recipient:to,ethAmount:'.01'}),/Insufficient/)
 assert.equal(c.sent.length,0)
})
test('wrong network and changed account cannot submit a reviewed transaction',async()=>{
 const c=connection(),review=await prepareTransfer({...c,recipient:to,ethAmount:'.01'})
 const wrong=connection({chain:'0x1'})
 await assert.rejects(()=>submitTransfer({...wrong,review}),/Sepolia/);assert.equal(wrong.sent.length,0)
 const changed=connection({accounts:[to]})
 await assert.rejects(()=>submitTransfer({...changed,review}),/account changed/);assert.equal(changed.sent.length,0)
 await assert.rejects(()=>verifyWallet(connection({accounts:[]}).injected,account),/disconnected/)
})
test('submit checks current balance and sends the reviewed request only once',async()=>{
 const c=connection(),review=await prepareTransfer({...c,recipient:to,ethAmount:'.01'})
 const poor=connection({balance:0n});await assert.rejects(()=>submitTransfer({...poor,review}),/balance changed/)
 assert.equal(poor.sent.length,0)
 const tx=await submitTransfer({...c,review});assert.equal(tx.hash,'mock-transaction-hash');assert.equal(c.sent.length,1);assert.deepEqual(c.sent[0],review.request)
})
test('wallet cancellation, already-open requests and failed estimation have clear messages',()=>{
 assert.match(transferError({code:4001}),/cancelled/)
 assert.match(transferError({code:'ACTION_REJECTED'}),/cancelled/)
 assert.match(transferError({code:-32002}),/already open/)
 assert.match(transferError({code:'CALL_EXCEPTION'}),/would fail/)
})
