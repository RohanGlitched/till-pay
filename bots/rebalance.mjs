/**
 * Moves test USDC from seeded clients back to the faucet (deployer) with EIP-3009 authorisations the
 * keeper submits, since the bots hold no MON. Usage: node bots/rebalance.mjs bot1=12 bot3=6
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, encodeFunctionData, hexToSignature, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://testnet-rpc.monad.xyz";
const USDC = "0x534b2f3A21130d7a60830c2Df862319e593943A3";
const keys = JSON.parse(fs.readFileSync(process.env.KEYS || "keys/wallets.json", "utf8"));
const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const keeper = createWalletClient({ account: privateKeyToAccount(keys.keeper.privateKey), chain, transport: http(RPC) });
const abi = parseAbi(["function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)"]);
const to = keys.deployer.address;

for (const arg of process.argv.slice(2)) {
  const [k, amt] = arg.split("=");
  const from = privateKeyToAccount(keys[k].privateKey);
  const value = BigInt(Math.round(Number(amt) * 1e6));
  const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 1800);
  const sig = await from.signTypedData({
    domain: { name: "USDC", version: "2", chainId: chain.id, verifyingContract: USDC },
    types: { TransferWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] },
    primaryType: "TransferWithAuthorization",
    message: { from: from.address, to, value, validAfter: 0n, validBefore, nonce },
  });
  const { v, r, s } = hexToSignature(sig);
  const data = encodeFunctionData({ abi, functionName: "transferWithAuthorization", args: [from.address, to, value, 0n, validBefore, nonce, Number(v), r, s] });
  const est = await pub.estimateGas({ account: keeper.account.address, to: USDC, data });
  const hash = await keeper.sendTransaction({ to: USDC, data, gas: (est * 115n) / 100n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(k, amt, rc.status, hash);
}
