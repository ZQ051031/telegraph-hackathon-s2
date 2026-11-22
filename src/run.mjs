import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import { decide } from "./dispatch.mjs";
import { MAX_UUSDC } from "./telegraph.mjs";

async function writeNew(path, value) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + "\n");
    await file.sync();
  } finally {
    await file.close();
  }
}

async function replaceRecord(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeNew(temporary, value);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function run(job, path, client, signer) {
  const quote = await client.quote(job);
  const record = {
    schemaVersion: 1,
    mode: "telegraph-sepolia-escrow",
    status: "authorization_pending",
    job,
    maxSpendUusdc: MAX_UUSDC,
    quote,
    purchase: null,
    recommendation: null,
  };
  // Reserve a new evidence path before sending an authorization. An interrupted
  // run leaves this file in place so it cannot automatically be replayed.
  try {
    await writeNew(path, record);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Run record already exists. Inspect it before starting another purchase.");
    throw error;
  }
  try {
    record.purchase = await client.buy(quote, signer);
    if (record.purchase.problem) {
      record.status = "review_required";
      record.problem = record.purchase.problem;
    } else {
      record.recommendation = decide(job.fleet, record.purchase.price);
      record.status = "recommended";
    }
  } catch {
    record.status = "authorization_outcome_unknown";
    record.problem = "The purchase did not complete locally. Check Telegraph accounting before starting another run.";
  }
  record.completedAt = new Date().toISOString();
  await replaceRecord(path, record);
  return record;
}
