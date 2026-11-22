# Build a receipt-backed curtailment decision

A wholesale power price is only one input to a fleet decision. A 1.2 MW mining fleet with a 60 PH/s hash rate can profit at one price and lose its advantage to a curtailment credit at another. GridMargin buys the price the decision depends on and records what it paid for alongside the result.

## 1. Find the typed purchase

The [live Intent schema](https://devnode.telegraphprotocol.com/engine/v1/intents/GRID_POWER_PRICE_GENERAL) lists the parameters `node_or_zone` and `interval_start`, the normalized `lmp_usd_per_mwh` result, and available miners. GridMargin looks for the CAISO day-ahead specialist by slug and resolves its current miner ID. The typed direct ask is subject to the direct miner’s availability. The operator’s hash rate, costs and credits remain local.

From a clone with `npm ci` completed, run the full live quote path.

```sh
npm run --silent gridmargin -- quote examples/np15.json
```

Inspect `quote.request`, `quote.miner` and `quote.escrow`. The [captured example](../evidence/live-quote.json) shows the exact requested hour, HTTP 402, the Sepolia escrow resource and the 10,000 μUSDC quoted amount.

## 2. Turn the price into an operating choice

```sh
npm run --silent gridmargin -- preview examples/np15.json 45
npm run --silent gridmargin -- preview examples/np15.json 100
```

These are manual scenario prices. At 45 USD/MWh, the run advantage is 43.30 USD and clears the 5 USD buffer. At 100 USD/MWh, the run advantage is −22.70 USD and curtailment wins. Try adjusting the power adder or curtailment credit in a copy of the job and rerunning the preview.

## 3. Pay autonomously and reconcile

Follow the [README’s testnet setup](../README.md#run-a-testnet-purchase) with your own funded Sepolia escrow. When you launch `run`, the agent requests its own challenge, checks the network, recipient, resource and cap, signs the exact scoped authorization with a fresh nonce, and sends one paid copy of the same request. The signed header stays out of the run record. The node’s output determines which recommendation the calculator produces.

Read `purchase.response.result.lmp_usd_per_mwh`, `purchase.receipt` and `recommendation` in the result. Run `verify` to check the published epoch delivery when it becomes available. The public signal URL can show the underlying miner response. A delivery receipt establishes billing for a request. Evaluate the price source and the operator assumptions separately when reviewing the recommendation.

## 4. Break it without spending

Copy the sample, change `intervalStart` to a half-hour or remove its `Z`, and call `quote`. The job is rejected locally. Run `npm test` to exercise mocked over-cap, missing-receipt, wrong-hour and timed-out purchase outcomes. These tests create no wallet, authorization accepted by Telegraph, or network charge.

If you reproduce the flow independently, share the hub, UTC hour, quote outcome and any useful error details. If you choose to share a paid receipt, remember that the published receipt can expose the payer address. A useful follow-up is a comparison of the quoted hub price against the published CAISO day-ahead observation for the same interval.
