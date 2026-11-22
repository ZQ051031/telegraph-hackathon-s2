# GridMargin

GridMargin helps Bitcoin mining operators decide whether to run or curtail a fleet for one CAISO settlement hour. It buys a day-ahead locational marginal price (LMP) on Telegraph testnet, applies the operator’s fleet economics, and records the recommendation, price and Telegraph receipt in one JSON file. This is an Apps & Agents entry for [Telegraph Hackathon Season II, Mission 12 — Mining and Power](https://hackathon.telegraphprotocol.com/missions/mining-and-power).

**Verification status.** The live Telegraph testnet returned HTTP 402 with a quote of 10,000 μUSDC for the sample NP15 request. The [captured quote](evidence/live-quote.json) records zero spend. A funded testnet run and a GridMargin purchase receipt are pending.

## Try it

Requires Git, Node.js 22+ and npm. The manual preview and live quote need no Telegraph credentials. Use a terminal at the root of the clone.

```sh
git clone https://github.com/ZQ051031/telegraph-hackathon-s2.git
cd telegraph-hackathon-s2
npm ci
npm test
npm run --silent gridmargin -- preview examples/np15.json 45
npm run --silent gridmargin -- quote examples/np15.json
```

With the manual price of 45 USD/MWh the example recommends `RUN`. The 1.2 MW fleet uses 1.2 MWh over the hour, estimates 53.30 USD in net mining value and compares it with a 10.00 USD curtailment credit. Its maximum run LMP is about 76.92 USD/MWh, including a 5 USD minimum run advantage. Pass 100 in place of 45 to see `CURTAIL`. Both preview prices are illustrative.

The quote command discovers the `zk-gridexact` CAISO specialist and sends this typed request to the selected Telegraph miner. The expected response is HTTP 402 with an Ethereum Sepolia escrow challenge. Quote availability does not establish that the requested hour has published price data.

```json
{
  "intent": "GRID_POWER_PRICE_GENERAL",
  "params": {
    "node_or_zone": "TH_NP15_GEN-APND",
    "interval_start": "2026-11-22T09:00:00Z"
  }
}
```

## Run a testnet purchase

1. Use your own dedicated Ethereum Sepolia signer with funded **Telegraph escrow** in Telegraph test USDC. The token and deposit contract are listed in the [official testnet escrow guide](https://github.com/telegraphprotocol/telegraph-docs/blob/main/using/escrow-inference.md). Funding escrow is a separate operator step and may require faucet Sepolia ETH for gas. The agent submits no funding or top-up transactions.
2. Try the sample or copy it to a new job file. For a fresh run choose NP15, SP15 or ZP26 and a completed UTC settlement hour from the last few days with CAISO day-ahead data. Set the fleet assumptions locally. Use public-safe values for any run record you intend to share.
3. Run the following in Bash from your own terminal. Turn off terminal recording before entering your signer key. The subshell clears the environment variable on exit.

```bash
mkdir -p run
(
  read -rsp 'Dedicated Sepolia signer key (0x…): ' GRIDMARGIN_SEPOLIA_KEY
  printf '\n'
  export GRIDMARGIN_SEPOLIA_KEY
  npm run --silent gridmargin -- run examples/np15.json run/np15-01.json
)
```

On a usable paid result, expect `recommended`, a `RUN` or `CURTAIL` decision based on the returned LMP, a paid amount in μUSDC and a receipt hash. The quoted amount can be at most **10,000 μUSDC (0.01 test USDC) per invocation**. The CLI signs for exactly that invocation’s quote and sends one authorized request. It never retries a purchase, and the same evidence path cannot be reused. Distinct deliberate invocations can each spend up to the cap. For example, 24 successful hourly calls at the observed flat price would total 0.24 test USDC.

Check the evidence once Telegraph publishes the receipt’s epoch block.

```sh
npm run --silent gridmargin -- verify run/np15-01.json
```

The run record contains the public request, quote, typed price response, signal URL when available, receipt and delivery URL. `verify` compares the node’s posted delivery with the saved receipt by epoch, hash, payer, miner, Intent and amount. It returns the node’s Merkle proof for inspection. It does not independently verify the Merkle proof against an on-chain root. `epoch_pending` means you can repeat the read-only check after the epoch is published.

## How the decision works

| Quantity | Calculation |
| --- | --- |
| Estimated gross mining revenue | Fleet PH/s × USD hashprice per PH/s per day ÷ 24 |
| Energy cost | Fleet MW × one hour × (purchased LMP + local power adder) |
| Run net | Gross revenue less the pool fee, energy cost and hourly variable cost |
| Curtail net | Operator-entered hourly curtailment credit |
| Recommendation | Run if run net is at least curtail net plus the minimum run advantage |

The purchasing code only sends the hub and interval to Telegraph. A purchase quote must match the pinned Sepolia escrow network, Diamond, typed ask resource and expected request-signing template. A recommendation requires a matching escrow receipt, the requested miner and typed input echo, and a usable LMP. Provider metadata, when present, must agree with the request. Normalized results and accounting stay with the decision so another operator can reproduce the calculation.

## Failure cases and boundaries

| What you see | What it means |
| --- | --- |
| Quote status `quoted_only` | Telegraph offered a price. No authorization or payment took place. |
| Quote rejected | The provider is unavailable or the challenge failed the network, recipient, template or cap checks. The agent did not sign. |
| HTTP 402 during `run` | Telegraph refused authorization. Inspect the run record and check your documented testnet escrow balance and clock. |
| `review_required` | The authorized request failed or its receipt or price was unusable. The record preserves accounting the node supplied. A delivered response with unusable data can still have a charge. |
| `authorization_pending` or `authorization_outcome_unknown` | The attempt may have reached Telegraph. Inspect accounting before starting a new attempt and keep the existing record. |
| `epoch_pending` | The receipt is saved and the public epoch block is not yet available. |

GridMargin models one flat-load hour and supports three CAISO hubs. It uses a single discovered specialist with no paid fallback. Hashprice and tariffs are operator estimates. Actual settled power cost can differ from hub LMP, and local demand charges, temperature limits, ramp constraints, lease alternatives and minimum downtime are outside the model. The recommendation is advisory. A production operator would need to reconcile against site tariffs and meter data and review decisions before controlling hardware. Keep keys off screen and out of Git. Telegraph can expose requests and payer addresses publicly through its signal and epoch endpoints.

## Walkthrough and submission material

- [Developer walkthrough](docs/walkthrough.md)
- [3½-minute screen recording script](docs/demo-script.md)
- [Three progress post drafts](docs/progress-drafts.md)
- [Official Season II rules](https://hackathon.telegraphprotocol.com/rules)
