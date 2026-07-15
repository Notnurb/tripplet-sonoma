// Browser-side wallet plumbing for the /store page. Deliberately dependency-
// free (no wagmi/viem — they would be the largest dependency in the app for
// four RPC calls): connect, switch chain, read a USDC balance, and sign one
// EIP-712 TransferWithAuthorization. Server code must never import this.

import {
    X402_VERSION,
    type PaymentPayload,
    type PaymentRequirements,
} from './types';

export interface Eip1193Provider {
    request(args: { method: string; params?: unknown }): Promise<unknown>;
}

export function getInjectedProvider(): Eip1193Provider | null {
    if (typeof window === 'undefined') return null;
    const eth = (window as { ethereum?: Eip1193Provider }).ethereum;
    return eth ?? null;
}

export async function requestAccount(provider: Eip1193Provider): Promise<string> {
    const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
    const account = accounts?.[0];
    if (!account) throw new Error('The wallet returned no accounts.');
    return account;
}

export interface ChainMeta {
    chainId: number;
    name: string;
    rpcUrl: string;
    explorerBase: string;
}

/** Switch the wallet to the store's chain, offering to add it if unknown. */
export async function ensureChain(provider: Eip1193Provider, chain: ChainMeta): Promise<void> {
    const hexId = '0x' + chain.chainId.toString(16);
    try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
    } catch (e) {
        // 4902 = chain not added to the wallet yet.
        if ((e as { code?: number })?.code !== 4902) throw e;
        await provider.request({
            method: 'wallet_addEthereumChain',
            params: [
                {
                    chainId: hexId,
                    chainName: chain.name,
                    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                    rpcUrls: [chain.rpcUrl],
                    blockExplorerUrls: [chain.explorerBase],
                },
            ],
        });
    }
}

function randomNonce(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sign the EIP-3009 TransferWithAuthorization the 402 challenge asked for and
 * wrap it into a spec-shaped PaymentPayload. Gasless for the payer — the
 * facilitator submits the transaction and pays the gas.
 */
export async function signTransferAuthorization(
    provider: Eip1193Provider,
    from: string,
    chainId: number,
    requirements: PaymentRequirements,
): Promise<PaymentPayload> {
    const nowSec = Math.floor(Date.now() / 1000);
    const authorization = {
        from,
        to: requirements.payTo,
        value: requirements.maxAmountRequired,
        validAfter: String(nowSec - 600), // absorb clock skew
        validBefore: String(nowSec + requirements.maxTimeoutSeconds),
        nonce: randomNonce(),
    };
    const typedData = {
        types: {
            EIP712Domain: [
                { name: 'name', type: 'string' },
                { name: 'version', type: 'string' },
                { name: 'chainId', type: 'uint256' },
                { name: 'verifyingContract', type: 'address' },
            ],
            TransferWithAuthorization: [
                { name: 'from', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'validAfter', type: 'uint256' },
                { name: 'validBefore', type: 'uint256' },
                { name: 'nonce', type: 'bytes32' },
            ],
        },
        domain: {
            name: requirements.extra?.name ?? 'USDC',
            version: requirements.extra?.version ?? '2',
            chainId,
            verifyingContract: requirements.asset,
        },
        primaryType: 'TransferWithAuthorization',
        message: authorization,
    };
    const signature = (await provider.request({
        method: 'eth_signTypedData_v4',
        params: [from, JSON.stringify(typedData)],
    })) as string;

    return {
        x402Version: X402_VERSION,
        scheme: 'exact',
        network: requirements.network,
        payload: { signature, authorization },
    };
}

/** balanceOf(owner) via eth_call — pre-flight so users see "not enough USDC"
 *  before a wallet prompt, not after. null = could not read (non-fatal). */
export async function fetchUsdcBalance(
    provider: Eip1193Provider,
    token: string,
    owner: string,
): Promise<bigint | null> {
    try {
        const data = '0x70a08231' + owner.slice(2).toLowerCase().padStart(64, '0');
        const result = (await provider.request({
            method: 'eth_call',
            params: [{ to: token, data }, 'latest'],
        })) as string;
        if (typeof result !== 'string' || !result.startsWith('0x') || result === '0x') return null;
        return BigInt(result);
    } catch {
        return null;
    }
}
