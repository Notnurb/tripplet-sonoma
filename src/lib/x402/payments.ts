// The pack-purchase settlement pipeline behind /api/x402/buy/[packId] — where
// money becomes API keys, so every path is deliberate:
//
//   challenge → decode → local checks → replay guard (DB row) → facilitator
//   verify → facilitator settle → mint/top-up key → receipt
//
// Guarantees:
//   - ACCOUNTLESS: nothing here reads cookies or sessions. The receipt IS the
//     credential (grant.apiKey), and replaying the same X-PAYMENT header
//     re-returns it — agents that lose a response lose nothing.
//   - REPLAY-SAFE: unique (network, payer, nonce) maps a re-sent header onto
//     its original row; settled rows replay the stored receipt instead of
//     double-granting.
//   - FAILS CLOSED: if the payments table or the facilitator is unreachable we
//     refuse (503), never "grant now, reconcile later".
//   - AMBIGUITY-RECOVERABLE: a /settle timeout leaves the row pending; on
//     retry, EIP-3009 authorizationState() is probed on-chain to decide
//     "settled → grant" vs "never landed → retry" without trusting anyone.
//   - The unpaid challenge path touches no DB, so agents probe 402s for free.

import type { NextRequest } from 'next/server';
import { isDbConfigured, isMissingTableError, queryOne, withTransaction } from '@/lib/db/neon';
import {
    PAYMENT_HEADER,
    PAYMENT_RESPONSE_HEADER,
    X402_VERSION,
    decodePaymentHeader,
    encodeSettlementHeader,
    paymentRequired,
    validatePaymentAgainstRequirements,
    type PaymentPayload,
    type SettlementResponse,
} from './types';
import { buildPackRequirements, getStoreConfig, type EnabledStoreConfig } from './config';
import { formatUsdcAtomic, getPack, type CreditPack } from './catalog';
import { facilitatorSettle, facilitatorVerify, isAuthorizationConsumed } from './facilitator';
import { authenticatePrepaidKey, deriveApiKey, hashApiKey, looksLikeApiKey, mintKey, topUpKey } from './keys';

/** Optional header naming an existing key to top up instead of minting. */
export const TOPUP_KEY_HEADER = 'X-Tripplet-Key';

export interface PurchaseResult {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
}

// Reasons recorded on rows whose settlement outcome is unknown; retries of
// these rows trigger the on-chain probe before believing a verify failure.
const AMBIGUOUS_REASON = 'settle-unreachable';
// A pending row untouched for this long is presumed abandoned mid-flight
// (instance died between create and finalize) and may be taken over.
const PENDING_TAKEOVER_MS = 120_000;

interface PaymentRow {
    id: string;
    product_id: string;
    network: string;
    payer: string;
    nonce: string;
    status: string;
    failure_reason: string | null;
    tx_hash: string | null;
    key_id: string | null;
    amount_atomic: string;
    receipt_json: Receipt | null;
    settled_at: Date | null;
    updated_at: Date;
}

const ROW_COLUMNS =
    'id, product_id, network, payer, nonce, status, failure_reason, tx_hash, key_id, amount_atomic, receipt_json, settled_at, updated_at';

export async function handlePackPurchase(
    req: NextRequest,
    packId: string,
): Promise<PurchaseResult> {
    const config = getStoreConfig();
    if (!config.enabled) {
        return { status: 503, body: { error: `Store unavailable: ${config.reason}`, enabled: false } };
    }

    const pack = getPack(packId);
    if (!pack) {
        return {
            status: 404,
            body: { error: `Unknown pack '${packId}'.`, catalog: `${config.appUrl}/api/x402/catalog` },
        };
    }

    const requirements = buildPackRequirements(config, pack);

    // 1. No payment → the 402 challenge. Zero DB work on this path.
    const header = req.headers.get(PAYMENT_HEADER);
    if (!header) {
        return { status: 402, body: paymentRequired(`${PAYMENT_HEADER} header is required`, requirements) };
    }

    // 2. Decode + shape-check.
    const decoded = decodePaymentHeader(header);
    if (!decoded.ok) {
        return { status: 400, body: paymentRequired(`Malformed ${PAYMENT_HEADER} header: ${decoded.error}`, requirements) };
    }
    const payment = decoded.payload;

    // 3. Cheap local validation before any DB row or facilitator round-trip.
    const rejection = validatePaymentAgainstRequirements(payment, requirements, Math.floor(Date.now() / 1000));
    if (rejection) {
        return { status: 402, body: paymentRequired(rejection, requirements) };
    }

    // 4. Top-up target, validated BEFORE any money moves — taking a payment
    // and then discovering the key is bogus would strand the credits.
    const topUpRaw = req.headers.get(TOPUP_KEY_HEADER)?.trim() || null;
    if (topUpRaw) {
        if (!looksLikeApiKey(topUpRaw)) {
            return { status: 400, body: { error: `${TOPUP_KEY_HEADER} is not a valid trpl_x4_ key — omit it to mint a new key.` } };
        }
        const auth = await authenticatePrepaidKey(topUpRaw);
        if (auth.status === 'db-unavailable') {
            return { status: 503, body: { error: 'Key storage unavailable — nothing was charged. Retry shortly.', retryable: true } };
        }
        if (auth.status === 'unknown' || auth.status === 'revoked') {
            return { status: 400, body: { error: `${TOPUP_KEY_HEADER} names an ${auth.status} key — omit it to mint a new key.` } };
        }
        // 'exhausted' is fine: topping up an empty key is the whole point.
    }

    if (!isDbConfigured()) {
        return { status: 503, body: { error: 'Payment storage unavailable — nothing was charged. Retry shortly.', retryable: true } };
    }

    // 5. Replay guard — claim the (network, payer, nonce) triple.
    const claim = await claimPaymentRow(config, pack, payment);
    if ('result' in claim) return claim.result;
    const row = claim.row;

    // 6. Facilitator verify, failing closed on infrastructure errors.
    const ambiguous = row.failure_reason === AMBIGUOUS_REASON;
    let verify;
    try {
        verify = await facilitatorVerify(config, payment, requirements);
    } catch (e) {
        // Ambiguous rows must stay pending — marking them failed would let a
        // later retry bury a payment that actually settled.
        if (!ambiguous) await markFailed(row.id, `facilitator unreachable during verify: ${msg(e)}`);
        return {
            status: 503,
            body: { error: 'Payment verification is temporarily unavailable. Retry with the same X-PAYMENT header.', retryable: true },
        };
    }

    if (!verify.isValid) {
        // A consumed nonce also fails verification — if THIS row previously
        // vanished into a settle timeout, ask the chain who is right.
        if (ambiguous) {
            const consumed = await isAuthorizationConsumed(config.network, row.payer, row.nonce);
            if (consumed === true) {
                console.warn(`[x402] payment ${row.id} recovered on-chain after a settle timeout (nonce consumed → funds arrived)`);
                return finalizeSettled(config, pack, row, topUpRaw, {
                    success: true,
                    network: config.network.id,
                    payer: row.payer,
                });
            }
            if (consumed === null) {
                return {
                    status: 503,
                    body: {
                        error: 'Settlement state cannot be determined right now. Retry with the same X-PAYMENT header.',
                        retryable: true,
                        receiptId: row.id,
                    },
                };
            }
            // consumed === false: the transfer never landed; fail normally.
        }
        await markFailed(row.id, `verify: ${verify.invalidReason ?? 'invalid payment'}`);
        return {
            status: 402,
            body: paymentRequired(`Payment verification failed: ${verify.invalidReason ?? 'invalid payment'}`, requirements),
        };
    }

    // 7. Settle — the irreversible step.
    let settlement: SettlementResponse;
    try {
        settlement = await facilitatorSettle(config, payment, requirements);
    } catch (e) {
        await queryOne(
            `UPDATE x402_payments SET failure_reason = $2, updated_at = now() WHERE id = $1`,
            [row.id, AMBIGUOUS_REASON],
        ).catch(() => null);
        console.error(`[x402] settle outcome unknown for payment ${row.id}: ${msg(e)}`);
        return {
            status: 503,
            body: {
                error:
                    'Settlement status unknown — the facilitator did not answer. Retry in ~2 minutes ' +
                    'with the SAME X-PAYMENT header; this payment can settle at most once.',
                retryable: true,
                receiptId: row.id,
            },
        };
    }

    if (!settlement.success) {
        await markFailed(row.id, `settle: ${settlement.errorReason ?? 'settlement failed'}`);
        return {
            status: 402,
            body: paymentRequired(`Settlement failed: ${settlement.errorReason ?? 'unknown reason'}`, requirements),
        };
    }

    // 8. Money has moved — mint/top-up + receipt. Never bounce past here.
    return finalizeSettled(config, pack, row, topUpRaw, settlement);
}

// ─── Replay guard ────────────────────────────────────────────────────────────

async function claimPaymentRow(
    config: EnabledStoreConfig,
    pack: CreditPack,
    payment: PaymentPayload,
): Promise<{ row: PaymentRow } | { result: PurchaseResult }> {
    const auth = payment.payload.authorization;
    const network = payment.network;
    const payer = auth.from.toLowerCase();
    const nonce = auth.nonce.toLowerCase();

    let inserted: PaymentRow | null = null;
    try {
        inserted = await queryOne<PaymentRow>(
            `INSERT INTO x402_payments (product_id, network, payer, nonce, pay_to, asset, amount_atomic)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (network, payer, nonce) DO NOTHING
             RETURNING ${ROW_COLUMNS}`,
            [pack.id, network, payer, nonce, config.payTo.toLowerCase(), config.network.usdc.address, usdAtomicOf(config, pack)],
        );
    } catch (e) {
        if (isMissingTableError(e)) {
            console.error('[x402] x402_payments table missing — run `npm run setup:db`');
        } else {
            console.error(`[x402] payment row insert failed: ${msg(e)}`);
        }
        return { result: storageUnavailable() };
    }
    if (inserted) return { row: inserted };

    // Unique collision → this exact authorization was seen before.
    const existing = await queryOne<PaymentRow>(
        `SELECT ${ROW_COLUMNS} FROM x402_payments WHERE network = $1 AND payer = $2 AND nonce = $3`,
        [network, payer, nonce],
    ).catch(() => null);
    if (!existing) return { result: storageUnavailable() };

    if (existing.status === 'settled') {
        return { result: replaySettledReceipt(existing) };
    }

    if (existing.status === 'failed') {
        // Failed settles never consumed the nonce — allow a fresh attempt.
        const taken = await queryOne<PaymentRow>(
            `UPDATE x402_payments SET status = 'pending', updated_at = now()
             WHERE id = $1 AND status = 'failed'
             RETURNING ${ROW_COLUMNS}`,
            [existing.id],
        ).catch(() => null);
        if (taken) return { row: taken };
        return { result: conflict() };
    }

    // Pending: someone else is mid-flight — unless they died long ago.
    const taken = await queryOne<PaymentRow>(
        `UPDATE x402_payments SET updated_at = now()
         WHERE id = $1 AND status = 'pending' AND updated_at < now() - interval '${Math.floor(PENDING_TAKEOVER_MS / 1000)} seconds'
         RETURNING ${ROW_COLUMNS}`,
        [existing.id],
    ).catch(() => null);
    if (taken) return { row: { ...taken, failure_reason: existing.failure_reason } };
    return { result: conflict() };
}

function storageUnavailable(): PurchaseResult {
    return {
        status: 503,
        body: { error: 'Payment storage unavailable — nothing was charged. Retry shortly.', retryable: true },
    };
}

function conflict(): PurchaseResult {
    return {
        status: 409,
        body: {
            error: 'This exact payment is already being processed. Retry shortly with the same X-PAYMENT header to get its receipt.',
            retryable: true,
        },
    };
}

// ─── Settled: mint/top-up + receipt (idempotent across replays) ──────────────

async function finalizeSettled(
    config: EnabledStoreConfig,
    pack: CreditPack,
    row: PaymentRow,
    topUpRaw: string | null,
    settlement: SettlementResponse,
): Promise<PurchaseResult> {
    const settledAt = new Date();

    let receipt: Receipt;
    try {
        receipt = await withTransaction(async (db) => {
            let grant: Receipt['grant'];
            let keyId: string;
            if (topUpRaw) {
                const topped = await topUpKey(db, hashApiKey(topUpRaw), pack.credits);
                if (topped) {
                    keyId = topped.id;
                    grant = {
                        kind: 'api-key',
                        mode: 'topped-up',
                        // The buyer already holds the key — never store or echo it.
                        apiKey: null,
                        keyPrefix: topped.key_prefix,
                        creditsAdded: pack.credits,
                        creditsRemaining: Number(topped.credits_remaining),
                        note: `Added ${pack.credits.toLocaleString()} credits to the key you sent in ${TOPUP_KEY_HEADER}.`,
                    };
                } else {
                    // Key vanished between pre-check and settle (revoked in the
                    // gap). Money moved — mint a fresh key rather than strand it.
                    const minted = await mintKey(db, row.id, `${pack.name} pack`, pack.credits);
                    keyId = minted.row.id;
                    grant = mintedGrant(minted.rawKey, minted.row.key_prefix, pack, Number(minted.row.credits_remaining),
                        'The key you asked to top up was no longer usable, so a fresh key was minted instead.');
                }
            } else {
                const minted = await mintKey(db, row.id, `${pack.name} pack`, pack.credits);
                keyId = minted.row.id;
                grant = mintedGrant(minted.rawKey, minted.row.key_prefix, pack, Number(minted.row.credits_remaining));
            }

            const built = buildReceipt(config, pack, row, settlement, settledAt, grant);
            await db.queryOne(
                `UPDATE x402_payments
                 SET status = 'settled', settled_at = $2, tx_hash = $3, failure_reason = NULL,
                     key_id = $4, receipt_json = $5, updated_at = now()
                 WHERE id = $1`,
                // Stored WITHOUT the raw key — replays re-derive minted keys.
                [row.id, settledAt, settlement.transaction ?? null, keyId,
                    JSON.stringify({ ...built, grant: { ...built.grant, apiKey: null } })],
            );
            return built;
        });
    } catch (e) {
        // Settlement landed but the grant transaction failed. For minted keys
        // the key is still derivable from the row id — return it and flag for
        // reconciliation instead of stranding the payment.
        console.error(`[x402] CRITICAL: settled payment ${row.id} could not be finalized in DB: ${msg(e)}`);
        const minted = !topUpRaw;
        receipt = buildReceipt(config, pack, row, settlement, settledAt, {
            kind: 'api-key',
            mode: minted ? 'minted' : 'topped-up',
            apiKey: null,
            keyPrefix: null,
            creditsAdded: pack.credits,
            creditsRemaining: null,
            note:
                'Payment settled but the credit grant hit a storage error. Retry this exact request ' +
                '(same X-PAYMENT header) shortly — it is idempotent and will complete the grant.',
        });
        return {
            status: 200,
            body: receipt,
            headers: { [PAYMENT_RESPONSE_HEADER]: encodeSettlementHeader(settlement) },
        };
    }

    return {
        status: 200,
        body: receipt,
        headers: { [PAYMENT_RESPONSE_HEADER]: encodeSettlementHeader(settlement) },
    };
}

function replaySettledReceipt(row: PaymentRow): PurchaseResult {
    const settlement: SettlementResponse = {
        success: true,
        transaction: row.tx_hash ?? undefined,
        network: row.network,
        payer: row.payer,
    };
    const receipt: Receipt | null = row.receipt_json ?? null;
    if (receipt) {
        // Replays are authenticated by possession of the payer's own signed
        // header, so re-surfacing a minted key to them is safe — and exactly
        // what an agent whose first response got lost needs. (Topped-up keys
        // are the buyer's own; there is nothing to re-surface.)
        if (receipt.grant.mode === 'minted') {
            receipt.grant.apiKey = deriveApiKey(row.id);
        }
        receipt.replayed = true;
        return {
            status: 200,
            body: receipt,
            headers: { [PAYMENT_RESPONSE_HEADER]: encodeSettlementHeader(settlement) },
        };
    }
    // Settled row without a stored receipt (crash window) — tell the caller to
    // re-run the idempotent finalize by retrying; refuse to guess a grant.
    return {
        status: 200,
        body: {
            x402Version: X402_VERSION,
            receiptId: row.id,
            replayed: true,
            note: 'Payment settled; the grant is completing. Retry this exact request to finish it.',
        },
        headers: { [PAYMENT_RESPONSE_HEADER]: encodeSettlementHeader(settlement) },
    };
}

// ─── Receipt shape ───────────────────────────────────────────────────────────

export interface Receipt {
    x402Version: typeof X402_VERSION;
    receiptId: string;
    replayed?: boolean;
    product: { id: string; name: string; priceUsd: string };
    payment: {
        network: string;
        testnet: boolean;
        asset: string;
        assetAddress: string;
        amount: string;
        amountAtomic: string;
        payer: string;
        transaction: string | null;
        explorerUrl: string | null;
    };
    grant: {
        kind: 'api-key';
        mode: 'minted' | 'topped-up';
        /** The bearer key. Present on mints (and their replays); never on top-ups. */
        apiKey: string | null;
        keyPrefix: string | null;
        creditsAdded: number;
        creditsRemaining: number | null;
        usage?: { endpoint: string; auth: string; docs: string };
        note: string;
    };
    purchasedAt: string;
}

function mintedGrant(
    rawKey: string,
    keyPrefix: string,
    pack: CreditPack,
    creditsRemaining: number,
    extraNote?: string,
): Receipt['grant'] {
    return {
        kind: 'api-key',
        mode: 'minted',
        apiKey: rawKey,
        keyPrefix,
        creditsAdded: pack.credits,
        creditsRemaining,
        note:
            (extraNote ? `${extraNote} ` : '') +
            'Treat apiKey as cash. It reappears on replays of this payment, so a lost response is recoverable.',
    };
}

function buildReceipt(
    config: EnabledStoreConfig,
    pack: CreditPack,
    row: PaymentRow,
    settlement: SettlementResponse,
    settledAt: Date,
    grant: Receipt['grant'],
): Receipt {
    const tx = settlement.transaction ?? row.tx_hash ?? null;
    return {
        x402Version: X402_VERSION,
        receiptId: row.id,
        product: { id: pack.id, name: pack.name, priceUsd: pack.priceUsd },
        payment: {
            network: row.network,
            testnet: config.network.testnet,
            asset: config.network.usdc.symbol,
            assetAddress: config.network.usdc.address,
            amount: formatUsdcAtomic(row.amount_atomic),
            amountAtomic: row.amount_atomic,
            payer: row.payer,
            transaction: tx,
            explorerUrl: tx ? `${config.network.explorerTx}${tx}` : null,
        },
        grant: {
            ...grant,
            usage: {
                endpoint: `${config.appUrl}/api/x402/chat/completions`,
                auth: 'Authorization: Bearer <apiKey>',
                docs: `${config.appUrl}/api/x402/catalog`,
            },
        },
        purchasedAt: settledAt.toISOString(),
    };
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function usdAtomicOf(config: EnabledStoreConfig, pack: CreditPack): string {
    return buildPackRequirements(config, pack).maxAmountRequired;
}

async function markFailed(rowId: string, reason: string): Promise<void> {
    await queryOne(
        `UPDATE x402_payments SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1`,
        [rowId, reason.slice(0, 500)],
    ).catch((e) => console.error(`[x402] could not mark payment ${rowId} failed: ${msg(e)}`));
}

function msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
