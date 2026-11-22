import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decide, validateJob } from "../src/dispatch.mjs";
import { run } from "../src/run.mjs";
import { INTENT, MAX_UUSDC, NODE, telegraph } from "../src/telegraph.mjs";

const example = JSON.parse(await readFile(new URL("../examples/np15.json", import.meta.url), "utf8"));
const job = validateJob(example);
const miner = { id: "714109", slug: "zk-gridexact", name: "CAISO specialist", compatible: true };
const diamond = "0x72a70e949362670bf8bcead24efc5b8f950aa08b";
const resource = `/v1/ask/${miner.id}`;
const network = "eip155:11155111";
const payer = "0x" + "Ab".repeat(20);
const hash = "0x" + "cd".repeat(32);
const publicReceipt = {
  receipt_hash: hash, rail: "escrow", payer: payer.toLowerCase(), miner: miner.id, intent: INTENT,
  amount_uusdc: "10000", epoch_id: 38, settlement: "epoch", chain: "telegraph", timestamp: 1_795_350_000,
};
const response = {
  miner_id: miner.id, intent: INTENT, result_shape: "intent",
  input: { node_or_zone: job.hub, interval_start: job.intervalStart },
  result: { lmp_usd_per_mwh: 45, node_or_zone: "NP15", interval_start: job.intervalStart, market: "DAM", currency: "USD" },
  field_status: { lmp_usd_per_mwh: "ok", node_or_zone: "ok", interval_start: "ok", market: "ok", currency: "ok" },
  cost_usd: 0.01, signal_hash: hash,
};

function challenge(amount = 10_000, overrides = {}) {
  const template = [
    "Telegraph Escrow Payment", "", "Wallet: {from}", `Pay To: ${diamond}`, `Network: ${network}`,
    `Amount: ${amount} uUSDC`, `Resource: ${resource}`,
    "Nonce: {nonce}", "Valid After: {validAfter}", "Valid Before: {validBefore}",
  ].join("\n");
  return { accepts: [{
    scheme: "escrow", network, payTo: diamond,
    extra: { message: template, resource, signWith: "personal_sign (EIP-191)" }, ...overrides,
  }] };
}

function stub({ quoteBody = challenge(), answer = response, receipt = publicReceipt, paidStatus = 200, onPaid } = {}) {
  const requests = [];
  const signed = [];
  const signer = {
    address: payer,
    async signMessage({ message }) {
      signed.push(message);
      return "test-signature";
    },
  };
  const client = telegraph(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith(`/intents/${INTENT}`)) return Response.json({ intent_id: INTENT, miners: [miner] });
    assert.equal(url, `${NODE}/engine${resource}`);
    if (!options.headers["X-PAYMENT"]) return Response.json(quoteBody, { status: 402 });
    if (onPaid) await onPaid();
    const headers = {};
    if (receipt) headers["X-PAYMENT-RESPONSE"] = Buffer.from(JSON.stringify(receipt)).toString("base64");
    return Response.json(answer, { status: paidStatus, headers });
  });
  return { client, signer, signed, requests };
}

test("dispatch uses the LMP and shows the economics of both actions", () => {
  const low = decide(job.fleet, 45);
  assert.equal(low.action, "RUN");
  assert.deepEqual([low.grossMiningRevenueUsd, low.poolFeeUsd, low.runNetUsd, low.curtailNetUsd], [125, 2.5, 53.3, 10]);
  assert.equal(low.maximumRunLmpUsdPerMwh, 76.916667);
  const cutoff = (122.5 - 8 - 10 - 5) / 1.2 - 6;
  assert.equal(decide(job.fleet, cutoff).action, "RUN");
  assert.equal(decide(job.fleet, cutoff + 0.000001).action, "CURTAIL");
  assert.equal(decide(job.fleet, 100).action, "CURTAIL");
  assert.equal(decide(job.fleet, -20).energyCostUsd, -16.8);
});

test("invalid or ambiguous jobs are rejected", () => {
  assert.throws(() => validateJob({ ...job, intervalStart: "2026-02-31T09:00:00Z" }), /valid UTC hour/);
  assert.throws(() => validateJob({ ...job, intervalStart: "2026-11-22T01:00:00-08:00" }), /valid UTC hour/);
  assert.throws(() => validateJob({ ...job, hub: "NPJUNK" }), /CAISO trading hub/);
  assert.throws(() => validateJob({ ...job, fleet: { ...job.fleet, powerMw: 0 } }), /powerMw/);
  assert.throws(() => decide(job.fleet, "45"), /LMP must be a number/);
});

test("quote is free and the signed request uses the same scoped body", async () => {
  const { client, signer, signed, requests } = stub();
  const quote = await client.quote(job);
  assert.equal(quote.escrow.amountUusdc, MAX_UUSDC);
  assert.equal(requests.length, 2);
  assert.equal(signed.length, 0);
  const result = await client.buy(quote, signer);
  assert.equal(requests.length, 3);
  assert.equal(result.receiptValid, true);
  assert.equal(result.price, 45);
  assert.equal(result.deliveryUrl, `${NODE}/v1/blocks/38/deliveries/${hash}`);
  assert.equal(result.signalUrl, `${NODE}/engine/v1/signal/${hash}`);
  const [, unpaid, paid] = requests;
  assert.equal(unpaid.options.body, paid.options.body);
  assert.deepEqual(Object.keys(JSON.parse(paid.options.body)), ["intent", "params"]);
  assert.equal(paid.options.redirect, "error");
  const payment = JSON.parse(Buffer.from(paid.options.headers["X-PAYMENT"], "base64").toString());
  assert.equal(payment.x402Version, 2);
  assert.equal(payment.network, network);
  const auth = payment.payload.authorization;
  assert.equal(auth.from, payer.toLowerCase());
  assert.equal(auth.to, diamond);
  assert.equal(auth.value, "10000");
  assert.equal(Number(auth.validBefore) - Number(auth.validAfter), 105);
  assert.deepEqual(signed, [quote.escrow.template.replace(/\{(\w+)\}/g, (_, key) => auth[key])]);
});

for (const [name, quoteBody] of [
  ["price above the cap", challenge(10_001)],
  ["foreign chain", challenge(10_000, { network: "eip155:1" })],
  ["foreign recipient", challenge(10_000, { payTo: payer })],
  ["different request resource", challenge(10_000, { extra: { resource: "/v1/ask" } })],
  ["unexpected signable content", challenge(10_000, {
    extra: { ...challenge().accepts[0].extra, message: challenge().accepts[0].extra.message + "\nExtra: test" },
  })],
]) {
  test(`quote refuses ${name} before signing`, async () => {
    const { client, signed, requests } = stub({ quoteBody });
    await assert.rejects(client.quote(job), /escrow/i);
    assert.equal(signed.length, 0);
    assert.equal(requests.length, 2);
  });
}

for (const [name, fixture, expected] of [
  ["missing receipt", { receipt: null }, /matching escrow receipt/],
  ["wrong amount", { receipt: { ...publicReceipt, amount_uusdc: "10001" } }, /matching escrow receipt/],
  ["wrong payer", { receipt: { ...publicReceipt, payer: diamond } }, /matching escrow receipt/],
  ["HTTP payment refusal", { paidStatus: 402 }, /HTTP 402/],
  ["missing typed price", { answer: { ...response, field_status: { lmp_usd_per_mwh: "missing" } } }, /usable USD\/MWh/],
  ["raw reply", { answer: { ...response, result_shape: "raw" } }, /typed response/],
  ["different hour in quote response", { answer: { ...response, input: { ...response.input, interval_start: "2026-11-22T10:00:00Z" } } }, /requested miner, hub and hour/],
  ["conflicting provider metadata", { answer: { ...response, result: { ...response.result, currency: "EUR" } } }, /metadata conflicts/],
]) {
  test(`purchase outcome suppresses recommendations for ${name}`, async () => {
    const { client, signer, requests } = stub(fixture);
    const result = await client.buy(await client.quote(job), signer);
    assert.match(result.problem, expected);
    assert.equal(result.price, undefined);
    assert.equal(requests.length, 3);
  });
}

test("run creates evidence before authorization and keeps receipt with the recommendation", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "gridmargin-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "run.json");
  const { client, signer, signed } = stub({
    async onPaid() {
      assert.equal(JSON.parse(await readFile(path, "utf8")).status, "authorization_pending");
    },
  });
  const result = await run(job, path, client, signer);
  assert.equal(result.status, "recommended");
  assert.equal(result.recommendation.action, "RUN");
  const record = await readFile(path, "utf8");
  assert.equal(JSON.parse(record).purchase.receipt.receipt_hash, hash);
  assert.doesNotMatch(record, /test-signature|X-PAYMENT/);
  await assert.rejects(run(job, path, client, signer), /already exists/);
  assert.equal(signed.length, 1);
});

test("a lost response leaves an unknown outcome without retrying", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "gridmargin-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "run.json");
  const { client, signer, signed } = stub({ onPaid() { throw Error("disconnected"); } });
  const result = await run(job, path, client, signer);
  assert.equal(result.status, "authorization_outcome_unknown");
  assert.equal(result.recommendation, null);
  assert.equal(JSON.parse(await readFile(path, "utf8")).status, result.status);
  assert.equal(signed.length, 1);
});

test("verify checks the public delivery and handles epoch lag", async () => {
  const delivery = {
    receipt_hash: hash, payer: payer.toLowerCase(), miner_id: miner.id, intent: INTENT, usdc: 10_000, class: "paid_consumer",
  };
  const proof = { deliveries_root: hash, proof: [hash], epoch_id: 38, delivery };
  const good = telegraph(async (url) => {
    assert.equal(url, `${NODE}/v1/blocks/38/deliveries/${hash}`);
    return Response.json(proof);
  });
  assert.equal((await good.verify(publicReceipt)).status, "delivery_matches");
  const bad = telegraph(async () => Response.json({ ...proof, delivery: { ...delivery, usdc: 20_000 } }));
  await assert.rejects(bad.verify(publicReceipt), /does not match/);
  const pending = telegraph(async () => Response.json({ error: "no block recorded for this epoch" }, { status: 404 }));
  assert.equal((await pending.verify(publicReceipt)).status, "epoch_pending");
});
