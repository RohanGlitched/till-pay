/**
 * Till's seeded people: three client studios and five freelancers who keep real tabs running on
 * Monad testnet, so the site always shows live pay. Freelancers clock in and out around their own
 * local working hours, and any freelancer hired by someone else (a judge) clocks in within seconds.
 * Every action is signed by the bot and submitted gaslessly through the forwarder by the keeper,
 * which also settles running tabs every few minutes.
 *
 *   RPC_URL=... TILL=0x... FORWARDER=0x... KEYS=keys/wallets.json node bots/till-bots.mjs
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, hexToSignature, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const TILL = process.env.TILL;
const FORWARDER = process.env.FORWARDER;
const DOLLAR = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC"; // Agora AUSD on Monad testnet
const AGORA_FAUCET = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";
const keys = JSON.parse(fs.readFileSync(process.env.KEYS || "keys/wallets.json", "utf8"));
const TICK_MS = Number(process.env.TICK_MS || 4000);
const SETTLE_EVERY_MS = Number(process.env.SETTLE_EVERY_MS || 1_200_000);
// When run from cron each minute, exit before the next run starts (cron + flock restart it).
const RUN_FOR_MS = Number(process.env.RUN_FOR_MS || 0);
// MON is the scarce resource on testnet, so the seeded tabs run lean on transactions: large budgets,
// two work blocks a day, and a settle every twenty minutes.
const usd = (n) => BigInt(Math.round(n * 1e6));
// AUSD comes from Agora's on-chain faucet, so studios fund themselves and budgets can be realistic.
const BUDGET = usd(Number(process.env.BUDGET || 40));
const TOPUP = usd(Number(process.env.TOPUP || 40));
const RECYCLE_ABOVE = usd(Number(process.env.RECYCLE_ABOVE || 1_000_000));
const STARTED = Date.now();

const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const keeper = createWalletClient({ account: privateKeyToAccount(keys.keeper.privateKey), chain, transport: http(RPC) });
const faucet = createWalletClient({ account: privateKeyToAccount(keys.deployer.privateKey), chain, transport: http(RPC) });

const tillAbi = parseAbi([
  "function tabsOf(address) view returns (uint256[])",
  "function getTabs(uint256[] ids) view returns ((uint256 id,(address payer,uint64 rate,bool held,bool closed,address payee,uint64 since,address invite,uint64 lastBlock,uint128 budget,uint128 banked,uint128 paid) tab,uint256 earned,uint256 owed,uint256 runway)[])",
  "function profileOf(address) view returns ((string name,string place,bytes3 currency))",
  "function setProfile(string name,string place,bytes3 currency)",
  "function openWithPermit(address payee,address invite,uint64 rate,uint128 budget,string memo,uint256 deadline,uint8 v,bytes32 r,bytes32 s) returns (uint256)",
  "function topUpWithPermit(uint256 id,uint128 amount,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function clockIn(uint256 id)",
  "function clockOut(uint256 id)",
  "function close(uint256 id)",
  "function settleMany(uint256[] ids) returns (uint256)",
]);
const fwdAbi = parseAbi([
  "function nonces(address) view returns (uint256)",
  "function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable",
]);
const dollarAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)",
]);

// UTC offsets are fixed here; good enough to keep each person to plausible local hours.
const CLIENTS = [
  { key: "bot1", name: "Northwind Studio", place: "Berlin", cur: "EUR" },
  { key: "bot2", name: "Lumen Labs", place: "Austin", cur: "USD" },
  { key: "bot3", name: "Kite & Co", place: "Singapore", cur: "SGD" },
];
const FREELANCERS = [
  { key: "bot4", name: "Ana Reyes", place: "Manila", cur: "PHP", utc: 8, client: "bot1", rate: 32, memo: "Brand system for autumn launch" },
  { key: "bot5", name: "Tunde Bakare", place: "Lagos", cur: "NGN", utc: 1, client: "bot2", rate: 45, memo: "Payments API integration" },
  { key: "bot6", name: "Priya Nair", place: "Pune", cur: "INR", utc: 5.5, client: "bot1", rate: 28, memo: "Illustrations for the help centre" },
  { key: "bot7", name: "Lucas Almeida", place: "São Paulo", cur: "BRL", utc: -3, client: "bot3", rate: 30, memo: "Product launch video" },
  { key: "bot8", name: "Wanjiru Kamau", place: "Nairobi", cur: "KES", utc: 3, client: "bot2", rate: 26, memo: "Website copy, five pages" },
];
const acct = (k) => privateKeyToAccount(keys[k].privateKey);
const BOT_ADDRS = new Set(Object.keys(keys).filter((k) => k.startsWith("bot")).map((k) => acct(k).address.toLowerCase()));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const bytes3 = (s) => `0x${Buffer.from(s).toString("hex").padEnd(6, "0")}`;

let keeperNonce = null;
/** Monad charges the gas limit, so every send uses the chain's estimate plus 15% (never less than minGas). */
async function sendFromKeeper(to, data, minGas = 0n) {
  if (keeperNonce == null) keeperNonce = await pub.getTransactionCount({ address: keeper.account.address, blockTag: "pending" });
  try {
    const est = await pub.estimateGas({ account: keeper.account.address, to, data });
    const gas = (est * 115n) / 100n > minGas ? (est * 115n) / 100n : minGas;
    const hash = await keeper.sendTransaction({ to, data, gas, nonce: keeperNonce++ });
    const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 300, timeout: 60_000 });
    if (r.status !== "success") throw new Error(`reverted ${hash}`);
    return hash;
  } catch (e) {
    keeperNonce = null;
    throw e;
  }
}

async function forward(k, fn, args) {
  const account = acct(k);
  const data = encodeFunctionData({ abi: tillAbi, functionName: fn, args });
  const est = await pub.estimateGas({ account: FORWARDER, to: TILL, data: `${data}${account.address.slice(2)}` });
  const gas = (est * 125n) / 100n + 5_000n;
  const nonce = await pub.readContract({ address: FORWARDER, abi: fwdAbi, functionName: "nonces", args: [account.address] });
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const message = { from: account.address, to: TILL, value: 0n, gas, nonce, deadline, data };
  const signature = await account.signTypedData({
    domain: { name: "Till", version: "1", chainId: chain.id, verifyingContract: FORWARDER },
    types: {
      ForwardRequest: [
        { name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" },
        { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" },
      ],
    },
    primaryType: "ForwardRequest",
    message,
  });
  const exec = encodeFunctionData({ abi: fwdAbi, functionName: "execute", args: [{ ...message, signature }] });
  return sendFromKeeper(FORWARDER, exec, gas + 70_000n);
}

async function permit(k, value) {
  const account = acct(k);
  const nonce = await pub.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "nonces", args: [account.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const sig = await account.signTypedData({
    domain: { name: "Agora Dollar", version: "1", chainId: chain.id, verifyingContract: DOLLAR },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner: account.address, spender: TILL, value, nonce, deadline },
  });
  const { v, r, s } = hexToSignature(sig);
  return { deadline, v: Number(v), r, s };
}

/** A freelancer passes their pay back to their client now and then, so the demo money keeps circulating. */
async function recycle(fromKey, toKey, value) {
  const from = acct(fromKey);
  const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const to = acct(toKey).address;
  const sig = await from.signTypedData({
    domain: { name: "Agora Dollar", version: "1", chainId: chain.id, verifyingContract: DOLLAR },
    types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { from: from.address, to, value, validAfter: 0n, validBefore, nonce },
  });
  const { v, r, s } = hexToSignature(sig);
  const data = encodeFunctionData({ abi: dollarAbi, functionName: "transferWithAuthorization", args: [from.address, to, value, 0n, validBefore, nonce, Number(v), r, s] });
  return sendFromKeeper(DOLLAR, data);
}

const usdcOf = (a) => pub.readContract({ address: DOLLAR, abi: dollarAbi, functionName: "balanceOf", args: [a] });

/**
 * Is this freelancer at work? Two blocks a day in their own time zone, 09:00 to 12:00 and 14:00 to
 * 18:00, like a real working day. Few clock-ins keep the relayer's MON use low.
 */
function onShift(f, now = new Date()) {
  const localMin = (now.getUTCHours() * 60 + now.getUTCMinutes() + f.utc * 60 + 1440) % 1440;
  if (process.env.ALWAYS_ON) return true;
  return (localMin >= 9 * 60 && localMin < 12 * 60) || (localMin >= 14 * 60 && localMin < 18 * 60);
}

async function ensureProfiles() {
  for (const p of [...CLIENTS, ...FREELANCERS]) {
    const cur = await pub.readContract({ address: TILL, abi: tillAbi, functionName: "profileOf", args: [acct(p.key).address] });
    if (cur.name === p.name) continue;
    await forward(p.key, "setProfile", [p.name, p.place, bytes3(p.cur)]);
    log(`profile set: ${p.name}, ${p.place}`);
  }
}

/** Studios top themselves up from Agora's testnet faucet (10,000 AUSD a call); the faucet wallet pays the gas. */
async function ensureClientFunds() {
  for (const c of CLIENTS) {
    const bal = await usdcOf(acct(c.key).address);
    if (bal >= BUDGET * 2n) continue;
    const data = encodeFunctionData({ abi: parseAbi(["function requestFunds(address recipient)"]), functionName: "requestFunds", args: [acct(c.key).address] });
    const est = await pub.estimateGas({ account: faucet.account.address, to: AGORA_FAUCET, data });
    const hash = await faucet.sendTransaction({ to: AGORA_FAUCET, data, gas: (est * 115n) / 100n });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`funding ${c.name} reverted`);
    log(`${c.name} topped up from Agora's AUSD faucet`);
  }
}

// Across cron runs, remember when running tabs were last settled.
const SETTLE_STAMP = process.env.SETTLE_STAMP || "";
let lastSettle = SETTLE_STAMP && fs.existsSync(SETTLE_STAMP) ? Number(fs.readFileSync(SETTLE_STAMP, "utf8")) || 0 : 0;

async function tick() {
  const now = Math.floor(Date.now() / 1000);
  const running = [];
  for (const f of FREELANCERS) {
    const me = acct(f.key).address;
    const ids = await pub.readContract({ address: TILL, abi: tillAbi, functionName: "tabsOf", args: [me] });
    const views = ids.length ? await pub.readContract({ address: TILL, abi: tillAbi, functionName: "getTabs", args: [ids] }) : [];
    let ownTab = null;
    for (const v of views) {
      const t = v.tab;
      if (t.closed || t.payee.toLowerCase() !== me.toLowerCase()) continue;
      const spent = v.earned >= t.budget;
      const fromBot = BOT_ADDRS.has(t.payer.toLowerCase());
      if (fromBot && t.payer.toLowerCase() === acct(f.client).address.toLowerCase()) ownTab = v;
      if (t.since > 0n && !spent) running.push(v);
      if (!fromBot) {
        // Hired by someone else (a judge): clock in straight away and work until the budget runs out
        // or 45 minutes pass, whichever comes first.
        if (t.since === 0n && !t.held && !spent) {
          const worked = Number(t.banked) * 3600 / Math.max(1, Number(t.rate));
          if (worked < 45 * 60) {
            await forward(f.key, "clockIn", [v.id]);
            log(`${f.name} clocked in on tab ${v.id} for a new client`);
          }
        } else if (t.since > 0n && now - Number(t.since) > 45 * 60) {
          await forward(f.key, "clockOut", [v.id]);
          log(`${f.name} clocked out of tab ${v.id} after 45 minutes`);
        }
      }
    }

    // Their regular client: keep one tab open, topped up, and follow working hours.
    const client = CLIENTS.find((c) => c.key === f.client);
    if (!ownTab) {
      const budget = BUDGET;
      if ((await usdcOf(acct(client.key).address)) < budget) continue;
      const p = await permit(client.key, budget);
      await forward(client.key, "openWithPermit", [me, "0x0000000000000000000000000000000000000000", BigInt(f.rate * 1e6), budget, f.memo, p.deadline, p.v, p.r, p.s]);
      log(`${client.name} opened a tab for ${f.name}`);
      continue;
    }
    const t = ownTab.tab;
    const left = t.budget - ownTab.earned;
    if (left < 1_000_000n && onShift(f)) {
      const amount = TOPUP;
      if ((await usdcOf(acct(client.key).address)) >= amount) {
        const p = await permit(client.key, amount);
        await forward(client.key, "topUpWithPermit", [ownTab.id, amount, p.deadline, p.v, p.r, p.s]);
        log(`${client.name} topped up ${f.name}'s tab ${ownTab.id}`);
      }
    }
    const want = onShift(f);
    if (want && t.since === 0n && !t.held && ownTab.earned < t.budget) {
      await forward(f.key, "clockIn", [ownTab.id]);
      log(`${f.name} clocked in (tab ${ownTab.id})`);
    } else if (!want && t.since > 0n) {
      await forward(f.key, "clockOut", [ownTab.id]);
      log(`${f.name} clocked out (tab ${ownTab.id})`);
    }

    // Pass earnings back to the client so the loop never runs dry.
    const earnedBal = await usdcOf(me);
    if (earnedBal > RECYCLE_ABOVE) {
      await recycle(f.key, f.client, earnedBal - 1_000_000n);
      log(`${f.name} sent ${(Number(earnedBal - 1_000_000n) / 1e6).toFixed(2)} AUSD back to ${client.name}`);
    }
  }

  if (Date.now() - lastSettle > SETTLE_EVERY_MS) {
    const due = running.filter((v) => v.owed > 50_000n).map((v) => v.id);
    if (due.length) {
      const data = encodeFunctionData({ abi: tillAbi, functionName: "settleMany", args: [due] });
      await sendFromKeeper(TILL, data);
      log(`settled ${due.length} running tabs`);
    }
    lastSettle = Date.now();
    if (SETTLE_STAMP) fs.writeFileSync(SETTLE_STAMP, String(lastSettle));
  }
}

async function main() {
  if (!TILL || !FORWARDER) throw new Error("Set TILL and FORWARDER.");
  log(`till bots on ${RPC}, keeper ${keeper.account.address}`);
  if (!process.env.SKIP_PROFILES) await ensureProfiles().catch((e) => log("profiles:", e.shortMessage || e.message));
  for (;;) {
    if (RUN_FOR_MS && Date.now() - STARTED > RUN_FOR_MS) return;
    try {
      await ensureClientFunds();
      await tick();
    } catch (e) {
      log("error:", e.shortMessage || e.message);
    }
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

main();
