"use client";
/**
 * GenLayer StudioNet through genlayer-js, signed by the connected wallet —
 * same pattern as Event-Weaver's lib/wallet.tsx. Passing the wallet's
 * address (not a private key) to createClient makes genlayer-js sign via
 * the injected provider (window.ethereum) instead of a raw local key, so
 * there is no separate custodial signer anywhere in this app: the wallet
 * you connect with is the wallet that signs everything, on both chains.
 */
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { GenLayerClient } from "genlayer-js/types";

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS ||
  "0xf363797335d66E6Af00502f43EDE872C5Fe19bCb") as `0x${string}`;

const STUDIONET_CHAIN_ID_HEX = `0x${studionet.id.toString(16)}`;

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function getProvider(): EthereumProvider {
  const eth = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
  if (!eth) throw new Error("No wallet found. Install MetaMask to continue.");
  return eth;
}

async function currentChainId(eth: EthereumProvider): Promise<string> {
  return ((await eth.request({ method: "eth_chainId" })) as string).toLowerCase();
}

async function addStudioNetwork(eth: EthereumProvider): Promise<void> {
  await eth.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: STUDIONET_CHAIN_ID_HEX,
        chainName: studionet.name,
        nativeCurrency: studionet.nativeCurrency,
        rpcUrls: studionet.rpcUrls.default.http,
        blockExplorerUrls: studionet.blockExplorers?.default
          ? [studionet.blockExplorers.default.url]
          : undefined,
      },
    ],
  });
}

/** Force the injected wallet onto GenLayer StudioNet before a write —
 * without this, MetaMask signs on whatever chain it currently has selected,
 * which "succeeds" in the wallet's eyes but never reaches this contract.
 *
 * Not every wallet reports "chain not added" as EIP-3085's code 4902 —
 * some wrap it in a generic RPC error, others just no-op the switch
 * silently instead of throwing. Relying on the error shape alone means the
 * add-network popup never fires for those wallets (seen in the field: a
 * fresh wallet stayed on its previous chain with no prompt at all). So
 * after attempting the switch we always re-read the wallet's actual active
 * chain and, if it still doesn't match, add the network explicitly and
 * retry the switch — regardless of whether the first attempt threw. */
export async function ensureStudioNetwork(): Promise<void> {
  const eth = getProvider();
  if ((await currentChainId(eth)) === STUDIONET_CHAIN_ID_HEX) return;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
    });
  } catch {
    // Any failure here (unrecognized chain code 4902, a differently-coded
    // RPC error, etc.) is handled the same way below: try adding it.
  }

  if ((await currentChainId(eth)) === STUDIONET_CHAIN_ID_HEX) return;

  await addStudioNetwork(eth);
  await eth.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: STUDIONET_CHAIN_ID_HEX }],
  });

  if ((await currentChainId(eth)) !== STUDIONET_CHAIN_ID_HEX) {
    throw new Error(
      "Please switch your wallet to the GenLayer Studio network to continue."
    );
  }
}

/** Retries only on rate-limit-shaped RPC errors (e.g. viem's
 * "Request is being rate limited" from eth_sendRawTransaction), with
 * exponential backoff. Any other error rethrows immediately. Keeps
 * sequential on-chain writes (create_competition -> open_competition)
 * under the network's 30 req/min ceiling. */
async function withBackoff<T>(
  fn: () => Promise<T>,
  { retries = 4, baseDelayMs = 1500 }: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= retries || !/rate.?limit/i.test(message)) throw err;
      await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
      attempt++;
    }
  }
}

/** Read-only client — always works, wallet or not. */
export const readClient = createClient({ chain: studionet });

export function getGenLayerClient(address: string): GenLayerClient<typeof studionet> {
  return createClient({ chain: studionet, account: address as `0x${string}` });
}

/** Submits and waits for ACCEPTED. Re-asserts the network on every write:
 * the user may have switched chains in their wallet after connecting.
 *
 * The post-write receipt poll below calls studio.genlayer.com/api directly
 * from the browser via fetch() — that endpoint sends no CORS headers for
 * browser origins, so this call ALWAYS fails cross-origin, every time, not
 * intermittently. It's non-fatal here: the write itself (signed and sent
 * through the wallet's own transport, not fetch) already succeeded once we
 * have `hash`. Every caller of genlayerWrite follows up with a backend
 * *_confirm route that re-checks the chain server-side (no CORS involved
 * there), so that's the real source of truth — not this browser-side poll. */
export async function genlayerWrite(
  address: string,
  functionName: string,
  args: unknown[],
  value?: bigint
): Promise<{ hash: string; receipt: unknown }> {
  await ensureStudioNetwork();
  const client = getGenLayerClient(address);
  const hash = (await withBackoff(() =>
    client.writeContract({
      address: CONTRACT_ADDRESS,
      functionName,
      // genlayer-js encodes primitives/arrays/objects as GenLayer calldata
      args: args as never[],
      value: value ?? 0n,
    })
  )) as string;
  let receipt: unknown = null;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: hash as never,
      status: "ACCEPTED" as never,
      interval: 3000,
      retries: 60,
    });
  } catch {
    // Expected CORS/fetch failure from the browser — see doc comment above.
    // The tx already landed; the caller's backend confirm route verifies it.
  }
  return { hash, receipt };
}
