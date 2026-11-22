const HUBS = new Set(["TH_NP15_GEN-APND", "TH_SP15_GEN-APND", "TH_ZP26_GEN-APND"]);
const UTC_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/;

export const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function numberInRange(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function validateJob(value) {
  if (!isRecord(value) || !HUBS.has(value.hub)) {
    throw new Error("hub must be a CAISO trading hub: TH_NP15_GEN-APND, TH_SP15_GEN-APND, or TH_ZP26_GEN-APND");
  }
  const { hub, intervalStart, fleet } = value;
  if (typeof intervalStart !== "string" || !UTC_HOUR.test(intervalStart) ||
      !Number.isFinite(Date.parse(intervalStart)) ||
      new Date(intervalStart).toISOString() !== intervalStart.replace("Z", ".000Z")) {
    throw new Error("intervalStart must be a valid UTC hour start (YYYY-MM-DDTHH:00:00Z)");
  }
  if (!isRecord(fleet)) throw new Error("fleet must be an object");
  const fields = {
    powerMw: [0.001, 10_000],
    hashratePhPerSecond: [0.001, 10_000_000],
    hashpriceUsdPerPhPerDay: [0, 1_000_000],
    poolFeePct: [0, 100],
    powerAdderUsdPerMwh: [-2_000, 20_000],
    variableCostUsdPerHour: [0, 1_000_000_000],
    curtailmentCreditUsdPerHour: [0, 1_000_000_000],
    minimumRunAdvantageUsd: [0, 1_000_000_000],
  };
  const validatedFleet = {};
  for (const [key, [min, max]] of Object.entries(fields)) {
    const value = fleet[key];
    if (!numberInRange(value, min, max)) throw new Error(`fleet.${key} must be a number between ${min} and ${max}`);
    validatedFleet[key] = value;
  }
  return { hub, intervalStart, fleet: validatedFleet };
}

export function decide(fleet, lmpUsdPerMwh) {
  if (!numberInRange(lmpUsdPerMwh, -2_000, 20_000)) {
    throw new Error("LMP must be a number between -2000 and 20000 USD/MWh");
  }
  // One one-hour interval means constant MW and MWh have the same numeric value.
  const energyMwh = fleet.powerMw;
  const grossMiningRevenueUsd = fleet.hashratePhPerSecond * fleet.hashpriceUsdPerPhPerDay / 24;
  const poolFeeUsd = grossMiningRevenueUsd * fleet.poolFeePct / 100;
  const deliveredPriceUsdPerMwh = lmpUsdPerMwh + fleet.powerAdderUsdPerMwh;
  const energyCostUsd = energyMwh * deliveredPriceUsdPerMwh;
  const runNetUsd = grossMiningRevenueUsd - poolFeeUsd - energyCostUsd - fleet.variableCostUsdPerHour;
  const curtailNetUsd = fleet.curtailmentCreditUsdPerHour;
  const runAdvantageUsd = runNetUsd - curtailNetUsd;
  const maximumRunLmpUsdPerMwh =
    (grossMiningRevenueUsd - poolFeeUsd - fleet.variableCostUsdPerHour -
      curtailNetUsd - fleet.minimumRunAdvantageUsd) / energyMwh - fleet.powerAdderUsdPerMwh;
  const metrics = {
    lmpUsdPerMwh,
    maximumRunLmpUsdPerMwh,
    energyMwh,
    grossMiningRevenueUsd,
    poolFeeUsd,
    deliveredPriceUsdPerMwh,
    energyCostUsd,
    variableCostUsd: fleet.variableCostUsdPerHour,
    runNetUsd,
    curtailNetUsd,
    runAdvantageUsd,
    minimumRunAdvantageUsd: fleet.minimumRunAdvantageUsd,
  };
  const displayedMetrics = Object.fromEntries(
    Object.entries(metrics).map(([key, value]) => [key, Number(value.toFixed(6))]),
  );
  return { action: lmpUsdPerMwh <= maximumRunLmpUsdPerMwh ? "RUN" : "CURTAIL", ...displayedMetrics };
}
