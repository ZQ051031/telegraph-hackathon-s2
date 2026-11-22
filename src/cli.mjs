import { readFile } from "node:fs/promises";
import { decide, validateJob } from "./dispatch.mjs";
import { run } from "./run.mjs";
import { telegraph } from "./telegraph.mjs";

const help = `GridMargin | one-hour CAISO mining dispatch

Usage:
  npm run --silent gridmargin -- preview <job.json> <lmp-usd-per-mwh>
  npm run --silent gridmargin -- quote   <job.json>
  npm run --silent gridmargin -- run     <job.json> <new-run-record.json>
  npm run --silent gridmargin -- verify  <run-record.json>

preview uses a manual price. quote requests a free Telegraph testnet challenge.
run makes one capped testnet escrow purchase and requires GRIDMARGIN_SEPOLIA_KEY.
verify reads the public epoch delivery for a saved receipt.`;

const load = async (path) => JSON.parse(await readFile(path, "utf8"));
const printJson = (value) => console.log(JSON.stringify(value, null, 2));

async function localSigner() {
  const key = process.env.GRIDMARGIN_SEPOLIA_KEY;
  if (typeof key !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Set GRIDMARGIN_SEPOLIA_KEY locally to your dedicated funded Sepolia signer before running a purchase");
  }
  const { privateKeyToAccount } = await import("viem/accounts");
  try {
    return privateKeyToAccount(key);
  } catch {
    throw new Error("GRIDMARGIN_SEPOLIA_KEY could not initialize a local signer");
  }
}

async function main([command, path, argument, ...extra]) {
  if (command === "--help" || command === "-h" || !command) return console.log(help);
  const expectedArguments = { preview: 2, quote: 1, run: 2, verify: 1 };
  if (!Object.hasOwn(expectedArguments, command) ||
      !path || Boolean(argument) !== (expectedArguments[command] === 2) || extra.length) {
    throw new Error(`Invalid command or arguments\n\n${help}`);
  }
  const input = await load(path);
  const client = telegraph();
  if (command === "verify") {
    if (input?.mode !== "telegraph-sepolia-escrow" || input.purchase?.receiptValid !== true) {
      throw new Error("Run record has no matching Telegraph escrow receipt to verify");
    }
    const verification = await client.verify(input.purchase.receipt);
    printJson(verification);
    if (verification.status === "epoch_pending") process.exitCode = 2;
    return;
  }
  const job = validateJob(input);
  if (command === "preview") {
    const price = argument.trim() ? Number(argument) : NaN;
    return printJson({ mode: "manual-price-preview", job, recommendation: decide(job.fleet, price) });
  }
  if (command === "quote") {
    return printJson({ mode: "telegraph-sepolia-escrow", status: "quoted_only", spentUusdc: 0, quote: await client.quote(job) });
  }
  const result = await run(job, argument, client, await localSigner());
  printJson({
    status: result.status,
    record: argument,
    recommendation: result.recommendation,
    paidAmountUusdc: result.purchase?.receiptValid ? Number(result.purchase.receipt.amount_uusdc) : null,
    receipt: result.purchase?.receipt ?? null,
    deliveryUrl: result.purchase?.deliveryUrl ?? null,
    problem: result.problem,
  });
  if (result.status !== "recommended") process.exitCode = 2;
}

main(process.argv.slice(2)).catch((error) => {
  // Preserve friendly JSON errors without echoing user-supplied file contents.
  console.error(error instanceof SyntaxError ? "Input file must contain valid JSON" : error.message);
  process.exitCode = 1;
});
