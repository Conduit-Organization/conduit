// Conduit BUYER node — discovers a seller on the storefront, negotiates, pays (identity-bound),
// receives the gated provider pubkey, and delegates the real inference. No orchestrator.
import crypto from 'node:crypto';
import Hyperswarm from 'hyperswarm';
import { Wallet as EthWallet } from 'ethers';
import { randomSeedHex, publicKeyHexFromSeed } from '../core/identity';

const TOPIC = crypto.createHash('sha256').update('conduit:market:v1').digest();
const PROMPT = process.env.PROMPT || 'In two sentences, explain why settling a payment in a stablecoin is useful when two strangers transact.';

// This process's QVAC consumer identity — set before the SDK touches the swarm.
const consumerSeed = process.env.CONSUMER_SEED || randomSeedHex();
const consumerPub = publicKeyHexFromSeed(consumerSeed);
process.env.QVAC_HYPERSWARM_SEED = consumerSeed;

const { loadConfig } = await import('../core/config');
const { loadEnv } = await import('../core/env');
const { getAccount } = await import('../core/wallet');
const { send, onMessages, bindMessage } = await import('../core/protocol');
const sdk: any = await import('@qvac/sdk');

const cfg = loadConfig();
const env = loadEnv();
const buyer = await getAccount(cfg.mnemonic, cfg.rpcUrl, 0); // buyer wallet = account 0
const signer = EthWallet.fromPhrase(env.mnemonic || env.CONDUIT_WALLET_MNEMONIC || ''); // same key, for the off-chain bind signature

let done = false;
let model = '';

const swarm = new Hyperswarm();
swarm.on('connection', (conn: any) => {
  onMessages(conn, async (m) => {
    if (done) return;
    if (m.type === 'offer') {
      model = m.model;
      console.log(`[buyer] discovered seller: ${m.model} @ ${m.priceBaseUnits} base-units, ~${m.tps} tps`);
      send(conn, { type: 'quoteReq', buyerConsumerPub: consumerPub, buyerWallet: buyer.address });
    } else if (m.type === 'quote') {
      console.log('[buyer] quote received; signing bind + paying…');
      const signature = await signer.signMessage(bindMessage(m.nonce, consumerPub, buyer.address));
      const tx = await buyer.transferToken(m.token, m.sellerWallet, BigInt(m.price));
      console.log('[buyer] paid', m.price, 'tx', String(tx?.hash).slice(0, 14) + '…');
      send(conn, { type: 'receipt', nonce: m.nonce, txHash: tx?.hash ?? '', buyerConsumerPub: consumerPub, buyerWallet: buyer.address, signature });
    } else if (m.type === 'reject') {
      console.error('[buyer] seller rejected:', m.reason);
      process.exit(1);
    } else if (m.type === 'grant') {
      done = true;
      console.log('[buyer] GRANT received → delegating', model, 'to provider', m.providerPub.slice(0, 16) + '…');
      const modelId = await sdk.loadModel({ modelSrc: sdk[model], modelType: 'llm', delegate: { providerPublicKey: m.providerPub, timeout: 60000, fallbackToLocal: false } });
      const run = sdk.completion({ modelId, history: [{ role: 'user', content: PROMPT }], stream: true, captureThinking: true, kvCache: false });
      let answer = '';
      for await (const ev of run.events) { if (ev.type === 'contentDelta') answer += ev.text; }
      const final = await run.final.catch(() => null);
      console.log('\n[buyer] ANSWER:', answer.trim());
      console.log(`[buyer] stats: ttft=${final?.stats?.timeToFirstToken} tps=${final?.stats?.tokensPerSecond} promptTokens=${final?.stats?.promptTokens}`);
      console.log('MARKET_OK');
      try { await sdk.close(); } catch {}
      try { swarm.destroy(); } catch {}
      setTimeout(() => process.exit(0), 500);
    }
  });
});

await swarm.join(TOPIC, { server: false, client: true }).flushed();
console.log('[buyer] searching the storefront for sellers…');
