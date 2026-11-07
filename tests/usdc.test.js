import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEther, parseUnits } from 'ethers'
import { validateTransfer, readTransferBalance, prepareTransfer, submitTransfer, transferReceiptStatus, USDC_ADDRESS, USDC_INTERFACE } from '../src/lib/transfers.js'
const account='0x0000000000000000000000000000000000000001',recipient='0x0000000000000000000000000000000000000002'
function wallet(options={}){
 const state={eth:parseEther('.1'),tokens:parseUnits('25',6),decimals:6n,code:'0x6000',simulate:true,...options},calls=[],sent=[]
 const injected={request:async({method})=>method==='eth_chainId'?'0xaa36a7':[account]}
 const provider={getCode:async address=>{assert.equal(address,USDC_ADDRESS);return state.code},getBalance:async()=>state.eth,estimateGas:async()=>65000n,getFeeData:async()=>({maxFeePerGas:2000000000n,maxPriorityFeePerGas:1000000000n}),call:async tx=>{
  assert.equal(tx.to,USDC_ADDRESS);const parsed=USDC_INTERFACE.parseTransaction({data:tx.data});calls.push(parsed.name)
  if(parsed.name==='decimals')return USDC_INTERFACE.encodeFunctionResult('decimals',[state.decimals])
  if(parsed.name==='balanceOf'){assert.equal(parsed.args[0],account);return USDC_INTERFACE.encodeFunctionResult('balanceOf',[state.tokens])}
  if(parsed.name==='transfer')return USDC_INTERFACE.encodeFunctionResult('transfer',[state.simulate])
  throw new Error('Unexpected contract method')
 },getSigner:async()=>({getAddress:async()=>account,sendTransaction:async request=>{sent.push(request);return {hash:'mock-usdc-hash'}}})}
 return{provider,injected,account,state,calls,sent}
}
test('USDC parses exactly six decimals and refuses fractional base units or unknown assets',()=>{
 assert.equal(validateTransfer(recipient,'1.123456','USDC').value,1123456n)
 assert.equal(validateTransfer(recipient,'0.000001','USDC').value,1n)
 assert.throws(()=>validateTransfer(recipient,'0.0000001','USDC'),/6 decimal/)
 assert.throws(()=>validateTransfer(recipient,'1','USDT'),/ETH or USDC/)
})
test('USDC wallet reads token balance and ETH gas balance independently',async()=>{
 const c=wallet(),balance=await readTransferBalance({...c,asset:'USDC'})
 assert.equal(balance.asset,'USDC');assert.equal(balance.decimals,6);assert.equal(balance.balance,25000000n);assert.equal(balance.ethBalance,c.state.eth)
 assert.deepEqual(new Set(c.calls),new Set(['decimals','balanceOf']));assert.equal(c.sent.length,0)
})
test('USDC preparation encodes transfer recipient and value, with zero native ETH value',async()=>{
 const c=wallet(),review=await prepareTransfer({...c,recipient,ethAmount:'1.123456',asset:'USDC'})
 assert.equal(review.request.to,USDC_ADDRESS);assert.equal(review.request.value,0n);assert.equal(review.recipient,recipient);assert.equal(review.assetAmount,1123456n);assert.equal(review.decimals,6)
 const call=USDC_INTERFACE.parseTransaction({data:review.request.data});assert.equal(call.name,'transfer');assert.equal(call.args[0],recipient);assert.equal(call.args[1],1123456n)
 assert.equal(review.request.chainId,11155111n);assert.equal(review.total,review.maxFee);assert.equal(c.sent.length,0)
 assert.ok(!c.calls.includes('approve'))
})
test('USDC balance, gas ETH balance and false simulation are separately enforced',async()=>{
 await assert.rejects(()=>prepareTransfer({...wallet({tokens:1n}),recipient,ethAmount:'1',asset:'USDC'}),/Insufficient Sepolia USDC/)
 await assert.rejects(()=>prepareTransfer({...wallet({eth:0n}),recipient,ethAmount:'1',asset:'USDC'}),/ETH for gas/)
 await assert.rejects(()=>prepareTransfer({...wallet({simulate:false}),recipient,ethAmount:'1',asset:'USDC'}),/simulation returned false/)
 await assert.rejects(()=>readTransferBalance({...wallet({decimals:18n}),asset:'USDC'}),/Unexpected USDC decimals/)
 await assert.rejects(()=>readTransferBalance({...wallet({code:'0x'}),asset:'USDC'}),/contract was not found/)
})
test('USDC submission rechecks tokens then invokes wallet signing with transfer calldata only',async()=>{
 const c=wallet(),review=await prepareTransfer({...c,recipient,ethAmount:'5',asset:'USDC'})
 c.state.tokens=0n;await assert.rejects(()=>submitTransfer({...c,review}),/USDC balance changed/);assert.equal(c.sent.length,0)
 c.state.tokens=25000000n;const tx=await submitTransfer({...c,review});assert.equal(tx.hash,'mock-usdc-hash');assert.equal(c.sent.length,1);assert.equal(c.sent[0].value,0n)
 assert.equal(USDC_INTERFACE.parseTransaction({data:c.sent[0].data}).name,'transfer')
})
test('USDC confirmation requires the exact matching token Transfer event',async()=>{
 const c=wallet(),review=await prepareTransfer({...c,recipient,ethAmount:'5',asset:'USDC'})
 const log={address:USDC_ADDRESS,...USDC_INTERFACE.encodeEventLog('Transfer',[account,recipient,5000000n])}
 assert.equal(transferReceiptStatus(null,review),'pending')
 assert.equal(transferReceiptStatus({status:0,logs:[log]},review),'failed')
 assert.equal(transferReceiptStatus({status:1,logs:[]},review),'unverified')
 assert.equal(transferReceiptStatus({status:1,logs:[{...log,address:recipient}]},review),'unverified')
 assert.equal(transferReceiptStatus({status:1,logs:[log]},review),'confirmed')
 assert.equal(transferReceiptStatus({status:1,logs:[log]},{...review,assetAmount:1n}),'unverified')
})
