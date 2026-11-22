import { randomUUID } from "node:crypto";
import { isRecord, numberInRange } from "./dispatch.mjs";

export const NODE = "https://devnode.telegraphprotocol.com";
export const INTENT = "GRID_POWER_PRICE_GENERAL";
export const MAX_UUSDC = 10_000;
const PROVIDER_SLUG = "zk-gridexact";
const NETWORK = "eip155:11155111";
const DIAMOND = "0x72a70e949362670bf8bcead24efc5b8f950aa08b";
const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^0x[0-9a-f]{64}$/i;
const MINER_ID = /^\d+$/;
const ZONED_TIME = /(?:Z|[+-]\d{2}:\d{2})$/i;

async function asJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function units(value) {
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function escrowQuote(body, resource) {
  const entry = Array.isArray(body?.accepts)
    ? body.accepts.find((item) => item?.scheme === "escrow" && item.network === NETWORK)
    : null;
  if (typeof entry?.payTo !== "string" || entry.payTo.toLowerCase() !== DIAMOND ||
      entry.extra?.resource !== resource ||
      entry.extra.signWith !== "personal_sign (EIP-191)" ||
      typeof entry.extra.message !== "string") {
    throw new Error("Telegraph did not offer the expected Sepolia escrow challenge");
  }
  const amount = entry.extra.message.match(/^Amount: (\d+) uUSDC$/m)?.[1];
  const amountUusdc = units(amount);
  if (amountUusdc === null || amountUusdc > MAX_UUSDC) {
    throw new Error(`Escrow quote is invalid or exceeds the ${MAX_UUSDC} μUSDC cap`);
  }
  const expected = [
    "Telegraph Escrow Payment", "", "Wallet: {from}", `Pay To: ${DIAMOND}`,
    `Network: ${NETWORK}`, `Amount: ${amount} uUSDC`, `Resource: ${resource}`,
    "Nonce: {nonce}", "Valid After: {validAfter}", "Valid Before: {validBefore}",
  ].join("\n");
  if (entry.extra.message !== expected) throw new Error("Unexpected escrow authorization template");
  return { scheme: "escrow", network: NETWORK, payTo: DIAMOND, amountUusdc, resource, template: entry.extra.message };
}

async function paymentHeader(quote, signer) {
  if (typeof signer.address !== "string" || !ADDRESS.test(signer.address)) {
    throw new Error("Invalid Sepolia signer address");
  }
  const now = Math.floor(Date.now() / 1_000);
  const escrow = quote.escrow;
  const authorization = {
    from: signer.address.toLowerCase(),
    to: escrow.payTo,
    value: String(escrow.amountUusdc),
    validAfter: String(now - 5),
    validBefore: String(now + 100),
    nonce: randomUUID(),
  };
  const message = escrow.template.replace(/\{(from|nonce|validAfter|validBefore)\}/g,
    (_, field) => authorization[field]);
  let signature;
  try {
    signature = await signer.signMessage({ message });
  } catch {
    throw new Error("The local signer could not authorize the escrow payment");
  }
  return Buffer.from(JSON.stringify({
    x402Version: 2, scheme: "escrow", network: NETWORK, payload: { signature, authorization },
  })).toString("base64");
}

function parseReceipt(header) {
  if (!header) return null;
  try {
    const { receipt_hash, rail, payer, miner, intent, amount_uusdc, epoch_id, settlement, chain, timestamp } =
      JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return { receipt_hash, rail, payer, miner, intent, amount_uusdc, epoch_id, settlement, chain, timestamp };
  } catch {
    return null;
  }
}

function receiptMatches(receipt, quote, payer) {
  return isRecord(receipt) && HASH.test(receipt.receipt_hash ?? "") &&
    receipt.rail === "escrow" && receipt.settlement === "epoch" && receipt.chain === "telegraph" &&
    typeof receipt.payer === "string" && receipt.payer.toLowerCase() === payer.toLowerCase() &&
    receipt.miner === quote.miner.id && receipt.intent === INTENT &&
    units(receipt.amount_uusdc) === quote.escrow.amountUusdc &&
    Number.isSafeInteger(receipt.epoch_id) && receipt.epoch_id > 0;
}

function sameInterval(actual, expected) {
  return typeof actual === "string" && ZONED_TIME.test(actual) && Date.parse(actual) === Date.parse(expected);
}

function sameHub(actual, expected) {
  return typeof actual === "string" && [expected, expected.split("_")[1]].includes(actual.trim().toUpperCase());
}

export function acceptedPrice(answer, quote) {
  const { node_or_zone, interval_start } = quote.request.params;
  if (answer?.intent !== INTENT || answer.miner_id !== quote.miner.id || answer.result_shape !== "intent" ||
      answer.input?.node_or_zone !== node_or_zone || !sameInterval(answer.input?.interval_start, interval_start)) {
    throw new Error("Answer is not a typed response for the requested miner, hub and hour");
  }
  const { result, field_status } = answer;
  if (field_status?.lmp_usd_per_mwh !== "ok" || !numberInRange(result?.lmp_usd_per_mwh, -2_000, 20_000)) {
    throw new Error("Provider did not return a usable USD/MWh price for this interval");
  }
  if ((field_status.node_or_zone === "ok" && !sameHub(result.node_or_zone, node_or_zone)) ||
      (field_status.interval_start === "ok" && !sameInterval(result.interval_start, interval_start)) ||
      (field_status.market === "ok" && !/^(?:caiso )?(?:dam|day[- ]ahead)(?: market)?$/i.test(String(result.market).trim())) ||
      (field_status.currency === "ok" && String(result.currency).trim().toUpperCase() !== "USD")) {
    throw new Error("The provider's price metadata conflicts with the requested CAISO day-ahead USD interval");
  }
  return result.lmp_usd_per_mwh;
}

export function deliveryUrl(receipt) {
  if (!HASH.test(receipt?.receipt_hash ?? "") || !Number.isSafeInteger(receipt?.epoch_id) || receipt.epoch_id < 1) {
    throw new Error("A valid Telegraph receipt hash and epoch are required");
  }
  return `${NODE}/v1/blocks/${receipt.epoch_id}/deliveries/${receipt.receipt_hash}`;
}

export function telegraph(fetcher = fetch) {
  const request = (url, options = {}) => fetcher(url, {
    ...options, redirect: "error", signal: AbortSignal.timeout(35_000),
  });
  const ask = (url, body, extra = {}) => request(url, {
    method: "POST", headers: { "content-type": "application/json", ...extra }, body,
  });

  return {
    async quote(job) {
      const discoveryUrl = `${NODE}/engine/v1/intents/${INTENT}`;
      const discovery = await request(discoveryUrl);
      if (!discovery.ok) throw new Error(`Telegraph discovery returned HTTP ${discovery.status}`);
      const schema = await asJson(discovery);
      const miner = Array.isArray(schema?.miners) ? schema.miners.find((row) => row?.slug === PROVIDER_SLUG) : null;
      if (schema?.intent_id !== INTENT || typeof miner?.id !== "string" ||
          !MINER_ID.test(miner.id) || miner.compatible !== true) {
        throw new Error("The CAISO specialist is absent or incompatible in Telegraph discovery");
      }
      const resource = `/v1/ask/${miner.id}`;
      const url = `${NODE}/engine${resource}`;
      const body = { intent: INTENT, params: { node_or_zone: job.hub, interval_start: job.intervalStart } };
      const response = await ask(url, JSON.stringify(body));
      if (response.status !== 402) throw new Error(`Expected an HTTP 402 quote from Telegraph, got ${response.status}`);
      return {
        discoveryUrl, miner: { id: miner.id, slug: miner.slug, name: miner.name },
        url, request: body, quotedAt: new Date().toISOString(), httpStatus: response.status,
        escrow: escrowQuote(await asJson(response), resource),
      };
    },

    async buy(quote, signer) {
      const header = await paymentHeader(quote, signer);
      const response = await ask(quote.url, JSON.stringify(quote.request), { "X-PAYMENT": header });
      const receipt = parseReceipt(response.headers.get("X-PAYMENT-RESPONSE"));
      const answer = await asJson(response);
      const receiptValid = receiptMatches(receipt, quote, signer.address);
      const evidence = {
        httpStatus: response.status,
        receipt,
        receiptValid,
        signalUrl: HASH.test(answer?.signal_hash ?? "") ? `${NODE}/engine/v1/signal/${answer.signal_hash}` : null,
        deliveryUrl: receiptValid ? deliveryUrl(receipt) : null,
        response: isRecord(answer) ? {
          miner_id: answer.miner_id, intent: answer.intent, input: answer.input, result_shape: answer.result_shape,
          result: answer.result_shape === "intent" ? answer.result : undefined,
          field_status: answer.field_status, cost_usd: answer.cost_usd, timestamp: answer.timestamp,
          signal_hash: answer.signal_hash,
        } : null,
      };
      if (!response.ok) {
        return { ...evidence, problem: `Telegraph returned HTTP ${response.status} after escrow authorization. Inspect the run record before trying again.` };
      }
      if (!receiptValid) return { ...evidence, problem: "Telegraph did not return a matching escrow receipt" };
      try {
        return { ...evidence, price: acceptedPrice(answer, quote) };
      } catch (error) {
        return { ...evidence, problem: error.message };
      }
    },

    async verify(receipt) {
      const url = deliveryUrl(receipt);
      const expectedAmount = units(receipt.amount_uusdc);
      if (receipt.rail !== "escrow" || receipt.intent !== INTENT || !MINER_ID.test(receipt.miner ?? "") ||
          !ADDRESS.test(receipt.payer ?? "") || expectedAmount === null || expectedAmount > MAX_UUSDC) {
        throw new Error("Run record does not contain a valid GridMargin receipt");
      }
      const response = await request(url);
      const proof = await asJson(response);
      if (response.status === 404 && proof?.error === "no block recorded for this epoch") {
        return { status: "epoch_pending", url, proof: null };
      }
      if (!response.ok) throw new Error(`Telegraph delivery lookup returned HTTP ${response.status}`);
      const delivery = proof?.delivery;
      if (proof?.epoch_id !== receipt.epoch_id || delivery?.receipt_hash !== receipt.receipt_hash ||
          typeof delivery?.payer !== "string" || delivery.payer.toLowerCase() !== receipt.payer.toLowerCase() ||
          delivery?.miner_id !== receipt.miner || delivery?.intent !== receipt.intent ||
          units(delivery?.usdc) !== expectedAmount || delivery.class !== "paid_consumer" ||
          !HASH.test(proof?.deliveries_root ?? "") || !Array.isArray(proof?.proof) ||
          !proof.proof.every((item) => HASH.test(item))) {
        throw new Error("The public epoch delivery does not match the saved receipt");
      }
      return { status: "delivery_matches", url, proof };
    },
  };
}
