/**
 * One full tab on Monad testnet, every step gasless through the forwarder, printing a transaction
 * link for each: fund a fresh client, open by invite (USDC permit), claim, clock in, settle while
 * working, pause, top up, resume, clock in again, cash out by transfer authorisation, close with
 * refund. Writes the results to proof.json for VERIFY.md.
 *
 *   TILL=0x... FORWARDER=0x... KEYS=keys/wallets.json node bots/proof.mjs
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeFunctionData, hexToSignature, http, parseAbi } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const RPC = process.env.RPC_URL || "https://testnet-rpc.monad.xyz";
const TILL = process.env.TILL;
const FORWARDER = process.env.FORWARDER;
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const keys = JSON.parse(fs.readFileSync(process.env.KEYS || "keys/wallets.json", "utf8"));
const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const keeper = createWalletClient({ account: privateKeyToAccount(keys.keeper.privateKey), chain, transport: http(RPC) });
const deployer = createWalletClient({ account: privateKeyToAccount(keys.deployer.privateKey), chain, transport: http(RPC) });

const tillAbi = parseAbi([
  "event Opened(uint256 indexed id, address indexed payer, address indexed payee, uint64 rate, uint128 budget, address invite, string memo)",
  "function inviteDigest(uint256 id, address claimer) view returns (bytes32)",
  "function setProfile(string name,string place,bytes3 currency)",
  "function openWithPermit(address payee,address invite,uint64 rate,uint128 budget,string memo,uint256 deadline,uint8 v,bytes32 r,bytes32 s) returns (uint256)",
  "function claim(uint256 id, bytes inviteSig)",
  "function clockIn(uint256 id)",
  "function clockOut(uint256 id)",
  "function hold(uint256 id, bool on)",
  "function topUpWithPermit(uint256 id,uint128 amount,uint256 deadline,uint8 v,bytes32 r,bytes32 s)",
  "function settle(uint256 id) returns (uint128)",
  "function close(uint256 id)",
  "function getTab(uint256 id) view returns ((uint256 id,(address payer,uint64 rate,bool held,bool closed,address payee,uint64 since,address invite,uint64 lastBlock,uint128 budget,uint128 banked,uint128 paid) tab,uint256 earned,uint256 owed,uint256 runway))",
]);
const fwdAbi = parseAbi([
  "function nonces(address) view returns (uint256)",
  "function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable",
]);
const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function nonces(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)",
]);

const steps = [];
const link = (h) => `https://testnet.monadvision.com/tx/${h}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function send(wallet, to, data, what) {
  const est = await pub.estimateGas({ account: wallet.account.address, to, data });
  const t0 = Date.now();
  const hash = await wallet.sendTransaction({ to, data, gas: (est * 115n) / 100n });
  const r = await pub.waitForTransactionReceipt({ hash, pollingInterval: 100 });
  if (r.status !== "success") throw new Error(`${what} reverted: ${hash}`);
  const ms = Date.now() - t0;
  steps.push({ what, hash, block: Number(r.blockNumber), ms, gasUsed: Number(r.gasUsed) });
  console.log(`${what.padEnd(46)} ${String(ms).padStart(5)} ms  ${link(hash)}`);
  return r;
}

async function forward(account, fn, args, what) {
  const data = encodeFunctionData({ abi: tillAbi, functionName: fn, args });
  const est = await pub.estimateGas({ account: FORWARDER, to: TILL, data: `${data}${account.address.slice(2)}` });
  const gas = (est * 125n) / 100n + 5_000n;
  const nonce = await pub.readContract({ address: FORWARDER, abi: fwdAbi, functionName: "nonces", args: [account.address] });
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const message = { from: account.address, to: TILL, value: 0n, gas, nonce, deadline, data };
  const signature = await account.signTypedData({
    domain: { name: "Till", version: "1", chainId: chain.id, verifyingContract: FORWARDER },
    types: { ForwardRequest: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "gas", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint48" }, { name: "data", type: "bytes" }] },
    primaryType: "ForwardRequest",
    message,
  });
  return send(keeper, FORWARDER, encodeFunctionData({ abi: fwdAbi, functionName: "execute", args: [{ ...message, signature }] }), what);
}

async function permit(account, value) {
  const nonce = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "nonces", args: [account.address] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const sig = await account.signTypedData({
    domain: { name: "USDC", version: "2", chainId: chain.id, verifyingContract: USDC },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner: account.address, spender: TILL, value, nonce, deadline },
  });
  const { v, r, s } = hexToSignature(sig);
  return { deadline, v: Number(v), r, s };
}

async function main() {
  const client = privateKeyToAccount(generatePrivateKey());
  const freelancer = privateKeyToAccount(generatePrivateKey());
  const invite = privateKeyToAccount(generatePrivateKey());
  console.log(`client ${client.address}\nfreelancer ${freelancer.address}\n`);

  await send(deployer, USDC, encodeFunctionData({ abi: usdcAbi, functionName: "transfer", args: [client.address, 1_500_000n] }), "Fund a fresh client with 1.50 test USDC");
  await forward(client, "setProfile", ["Halden & Rao", "Rotterdam", "0x455552"], "Client sets a profile (gasless)");
  await forward(freelancer, "setProfile", ["Amara Osei", "Accra", "0x555344"], "Freelancer sets a profile (gasless)");

  const p1 = await permit(client, 1_000_000n);
  const opened = await forward(client, "openWithPermit", ["0x0000000000000000000000000000000000000000", invite.address, 36_000_000n, 1_000_000n, "Proof run: logo refresh", p1.deadline, p1.v, p1.r, p1.s], "Open a tab by invite, $36/h, $1 budget (permit)");
  const id = opened.logs.map((l) => { try { return decodeEventLog({ abi: tillAbi, data: l.data, topics: l.topics }); } catch { return null; } }).find((e) => e?.eventName === "Opened").args.id;
  console.log(`tab ${id}`);

  const digest = await pub.readContract({ address: TILL, abi: tillAbi, functionName: "inviteDigest", args: [id, freelancer.address] });
  const inviteSig = await invite.signMessage({ message: { raw: digest } });
  await forward(freelancer, "claim", [id, inviteSig], "Freelancer claims the invite");
  await forward(freelancer, "clockIn", [id], "Freelancer clocks in");
  for (let i = 1; i <= 3; i++) {
    await sleep(5000);
    await send(keeper, TILL, encodeFunctionData({ abi: tillAbi, functionName: "settle", args: [id] }), `Payout ${i} while working (anyone can settle)`);
  }
  await forward(client, "hold", [id, true], "Client pauses pay (stops the clock)");
  const p2 = await permit(client, 500_000n);
  await forward(client, "topUpWithPermit", [id, 500_000n, p2.deadline, p2.v, p2.r, p2.s], "Client tops up $0.50 (permit)");
  await forward(client, "hold", [id, false], "Client resumes pay");
  await forward(freelancer, "clockIn", [id], "Freelancer clocks in again");
  await sleep(6000);
  await forward(freelancer, "clockOut", [id], "Freelancer clocks out");
  await send(keeper, TILL, encodeFunctionData({ abi: tillAbi, functionName: "settle", args: [id] }), "Final payout");

  // Cash out: the freelancer moves pay on with an EIP-3009 authorisation; the keeper submits it.
  const bal = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [freelancer.address] });
  const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const to = deployer.account.address;
  const sig = await freelancer.signTypedData({
    domain: { name: "USDC", version: "2", chainId: chain.id, verifyingContract: USDC },
    types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { from: freelancer.address, to, value: bal, validAfter: 0n, validBefore, nonce },
  });
  const { v, r, s } = hexToSignature(sig);
  await send(keeper, USDC, encodeFunctionData({ abi: usdcAbi, functionName: "transferWithAuthorization", args: [freelancer.address, to, bal, 0n, validBefore, nonce, Number(v), r, s] }), `Freelancer cashes out $${(Number(bal) / 1e6).toFixed(4)} (EIP-3009)`);

  await forward(client, "close", [id], "Client closes the tab; unspent budget refunded");
  const view = await pub.readContract({ address: TILL, abi: tillAbi, functionName: "getTab", args: [id] });
  const refunded = await pub.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [client.address] });
  const paid = Number(view.tab.paid) / 1e6;
  console.log(`\npaid to freelancer $${paid.toFixed(6)}, refunded to client $${(Number(refunded) / 1e6).toFixed(6)}, budget $1.50`);
  // Return the client's refund to the faucet.
  const nonce2 = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
  const sig2 = await client.signTypedData({
    domain: { name: "USDC", version: "2", chainId: chain.id, verifyingContract: USDC },
    types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { from: client.address, to, value: refunded, validAfter: 0n, validBefore, nonce: nonce2 },
  });
  const s2 = hexToSignature(sig2);
  await send(keeper, USDC, encodeFunctionData({ abi: usdcAbi, functionName: "transferWithAuthorization", args: [client.address, to, refunded, 0n, validBefore, nonce2, Number(s2.v), s2.r, s2.s] }), "Client's refund returned to the faucet");

  fs.writeFileSync("proof.json", JSON.stringify({ tab: Number(id), client: client.address, freelancer: freelancer.address, paid, refunded: Number(refunded) / 1e6, steps }, null, 2));
}

main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exit(1);
});
