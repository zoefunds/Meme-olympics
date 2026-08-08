/**
 * Base Sepolia payment layer — minimal EIP-1193 wrapper, same pattern as
 * Event-Weaver's wallet.tsx: talk to `window.ethereum` directly rather than
 * a heavyweight connector SDK. The backend (services/baseSepolia.ts,
 * lib/escrowAbi.ts) already returns fully-encoded calldata, so the frontend
 * only has to get the connected wallet to sign and send it. This is the
 * SAME wallet used for GenLayer (see lib/genlayer.ts) — there is no
 * separate custodial signer anymore.
 */

const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14a34"; // 84532

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
};

function getProvider(): Eip1193Provider {
  const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!eth) {
    throw new Error(
      "No wallet found. Install MetaMask (or another browser wallet) to continue."
    );
  }
  return eth;
}

export function hasInjectedWallet(): boolean {
  return typeof window !== "undefined" && Boolean((window as any).ethereum);
}

/** Requests account access. Pass `switchChain: false` for actions that
 * don't touch Base Sepolia (e.g. just signing a login message) so we don't
 * force an unnecessary network-switch prompt. */
export async function connectWallet(
  { switchChain = true }: { switchChain?: boolean } = {}
): Promise<string> {
  const eth = getProvider();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts?.[0]) throw new Error("No account returned by wallet");
  if (switchChain) await ensureBaseSepolia();
  return accounts[0];
}

/** Signs a plain text message with the connected wallet (personal_sign) —
 * used for the wallet-connect login flow (sign-in-with-wallet), not a
 * transaction, costs no gas. */
export async function signMessage(address: string, message: string): Promise<string> {
  const eth = getProvider();
  const signature = (await eth.request({
    method: "personal_sign",
    params: [message, address],
  })) as string;
  return signature;
}

async function currentChainId(eth: Eip1193Provider): Promise<string> {
  return ((await eth.request({ method: "eth_chainId" })) as string).toLowerCase();
}

async function addBaseSepolia(eth: Eip1193Provider): Promise<void> {
  await eth.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
        chainName: "Base Sepolia",
        nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://sepolia.base.org"],
        blockExplorerUrls: ["https://sepolia.basescan.org"],
      },
    ],
  });
}

/** Not every wallet reports "chain not added" as EIP-3085's code 4902 —
 * some wrap it in a generic RPC error, others just no-op the switch
 * silently instead of throwing. Relying on the error shape alone means the
 * add-network popup never fires for those wallets (seen in the field: a
 * fresh wallet stayed on its previous chain with no prompt at all). So
 * after attempting the switch we always re-read the wallet's actual active
 * chain and, if it still doesn't match, add the network explicitly and
 * retry the switch — regardless of whether the first attempt threw. */
export async function ensureBaseSepolia(): Promise<void> {
  const eth = getProvider();
  if ((await currentChainId(eth)) === BASE_SEPOLIA_CHAIN_ID_HEX) return;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
    });
  } catch {
    // Handled uniformly below: try adding it regardless of error shape.
  }

  if ((await currentChainId(eth)) === BASE_SEPOLIA_CHAIN_ID_HEX) return;

  await addBaseSepolia(eth);
  await eth.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
  });

  if ((await currentChainId(eth)) !== BASE_SEPOLIA_CHAIN_ID_HEX) {
    throw new Error("Please switch your wallet to the Base Sepolia network to continue.");
  }
}

export interface EscrowTxStep {
  label?: string;
  to: string;
  data: string;
  value?: string;
}

/** Sends one pre-encoded transaction from the connected wallet and waits
 * only for the user's wallet to submit it (not for confirmation — the
 * caller can poll the backend or just tell the user to check their wallet). */
export async function sendEscrowTx(step: EscrowTxStep): Promise<string> {
  const eth = getProvider();
  const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
  const from = accounts?.[0];
  if (!from) throw new Error("Connect your wallet first");
  const txHash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: step.to, data: step.data, value: step.value || "0x0" }],
  })) as string;
  return txHash;
}

/** Sends a sequence of steps (e.g. approve, then deposit) in order, one
 * wallet confirmation each. Stops and rethrows on the first failure. */
export async function sendEscrowTxSequence(steps: EscrowTxStep[]): Promise<string[]> {
  const hashes: string[] = [];
  for (const step of steps) {
    hashes.push(await sendEscrowTx(step));
  }
  return hashes;
}
