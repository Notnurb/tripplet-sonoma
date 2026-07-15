// Server-side x402 store configuration. All X402_* env vars are optional —
// with nothing set, the storefront renders a "not configured" state and the
// paid endpoints answer 503 instead of crashing the build.
//
// Network constants (USDC contracts, EIP-712 domain names) are verbatim from
// the coinbase/x402 reference implementation; get them wrong and every client
// signature fails verification.

import { env } from '@/lib/env';
import type { PaymentRequirements } from './types';
import { usdToUsdcAtomic, type CallableModel, type CreditPack } from './catalog';

export interface X402NetworkInfo {
    /** x402 v1 network identifier (also what clients put in PaymentPayload). */
    id: 'base' | 'base-sepolia';
    chainId: number;
    label: string;
    testnet: boolean;
    /** Public JSON-RPC endpoint — used only for read-only recovery checks. */
    rpcUrl: string;
    /** Prefix a tx hash onto this for a block-explorer link. */
    explorerTx: string;
    usdc: {
        address: string;
        symbol: 'USDC';
        decimals: 6;
        /** EIP-712 domain fields of the token contract — differ per deployment! */
        eip712Name: string;
        eip712Version: string;
    };
    /** null = no keyless public facilitator; X402_FACILITATOR_URL is required. */
    defaultFacilitator: string | null;
    /** Where testers can get funds (testnet only). */
    faucet?: string;
}

export const X402_NETWORKS: Record<'base' | 'base-sepolia', X402NetworkInfo> = {
    'base-sepolia': {
        id: 'base-sepolia',
        chainId: 84532,
        label: 'Base Sepolia (testnet)',
        testnet: true,
        rpcUrl: 'https://sepolia.base.org',
        explorerTx: 'https://sepolia.basescan.org/tx/',
        usdc: {
            address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            symbol: 'USDC',
            decimals: 6,
            eip712Name: 'USDC',
            eip712Version: '2',
        },
        // Coinbase's free testnet facilitator.
        defaultFacilitator: 'https://x402.org/facilitator',
        faucet: 'https://faucet.circle.com',
    },
    base: {
        id: 'base',
        chainId: 8453,
        label: 'Base',
        testnet: false,
        rpcUrl: 'https://mainnet.base.org',
        explorerTx: 'https://basescan.org/tx/',
        usdc: {
            address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            symbol: 'USDC',
            decimals: 6,
            eip712Name: 'USD Coin',
            eip712Version: '2',
        },
        // Mainnet settlement needs an authenticated facilitator (e.g. the CDP
        // one) — deliberately no default so nobody ships mainnet by accident.
        defaultFacilitator: null,
    },
};

export type StoreConfig =
    | {
          enabled: true;
          network: X402NetworkInfo;
          payTo: string;
          facilitatorUrl: string;
          facilitatorApiKey?: string;
          appUrl: string;
      }
    | {
          enabled: false;
          reason: string;
          network: X402NetworkInfo;
          appUrl: string;
      };

export type EnabledStoreConfig = Extract<StoreConfig, { enabled: true }>;

export function getStoreConfig(): StoreConfig {
    const networkId = env.X402_NETWORK ?? 'base-sepolia';
    const network = X402_NETWORKS[networkId];
    const appUrl = (env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

    const payTo = env.X402_PAY_TO;
    if (!payTo) {
        return {
            enabled: false,
            reason: 'X402_PAY_TO is not set — the store has no merchant wallet to receive USDC.',
            network,
            appUrl,
        };
    }

    const facilitatorUrl = env.X402_FACILITATOR_URL ?? network.defaultFacilitator;
    if (!facilitatorUrl) {
        return {
            enabled: false,
            reason: `No facilitator configured for '${network.id}': set X402_FACILITATOR_URL (mainnet has no keyless default).`,
            network,
            appUrl,
        };
    }

    return {
        enabled: true,
        network,
        payTo,
        facilitatorUrl: facilitatorUrl.replace(/\/+$/, ''),
        facilitatorApiKey: env.X402_FACILITATOR_API_KEY,
        appUrl,
    };
}

/** How long a signed authorization gets to reach on-chain settlement. Humans
 *  need time to read a wallet prompt; agents just get slack for retries. */
export const MAX_TIMEOUT_SECONDS = 300;

function baseRequirements(config: EnabledStoreConfig): Pick<
    PaymentRequirements,
    'scheme' | 'network' | 'mimeType' | 'payTo' | 'maxTimeoutSeconds' | 'asset' | 'extra'
> {
    return {
        scheme: 'exact',
        network: config.network.id,
        mimeType: 'application/json',
        payTo: config.payTo,
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        asset: config.network.usdc.address,
        extra: {
            name: config.network.usdc.eip712Name,
            version: config.network.usdc.eip712Version,
        },
    };
}

export function buildPackRequirements(config: EnabledStoreConfig, pack: CreditPack): PaymentRequirements {
    return {
        ...baseRequirements(config),
        maxAmountRequired: usdToUsdcAtomic(pack.priceUsd),
        resource: `${config.appUrl}/api/x402/buy/${pack.id}`,
        description:
            `${pack.name} pack: ${pack.description} The response is a receipt whose ` +
            `grant.apiKey field contains the bearer key for ${config.appUrl}/api/x402/chat/completions. ` +
            `Replaying the same X-PAYMENT header returns the same receipt and key (idempotent).`,
    };
}

export function buildCallRequirements(config: EnabledStoreConfig, model: CallableModel): PaymentRequirements {
    return {
        ...baseRequirements(config),
        maxAmountRequired: usdToUsdcAtomic(model.pricePerCallUsd),
        resource: `${config.appUrl}/api/x402/chat/completions`,
        description:
            `One ${model.name} chat completion (model '${model.id}', up to ${model.maxOutputTokens} output tokens). ` +
            `POST an OpenAI-style body {model, messages, max_tokens?} with the X-PAYMENT header. ` +
            `Price varies by model — challenge with your intended body to get the exact quote. ` +
            `Prepaid keys (Authorization: Bearer trpl_x4_...) skip per-call payment; buy one at ${config.appUrl}/api/x402/catalog.`,
    };
}
