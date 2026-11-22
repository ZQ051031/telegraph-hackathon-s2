# Public progress drafts

Publish in your own voice on separate dates during Season II. Replace bracketed placeholders with observed results and URLs before posting. The third draft is ready to use once you have a successful paid run and the demo. On X, tag `@Telegraphprotoc`. Keep the hackathon participation disclosure in each post.

## 1. Explain the operating decision

I’m building GridMargin for the Mining and Power mission in the prize-bearing Telegraph Season II hackathon. A mining operator deciding whether to run a fleet for an hour needs the expected mining margin and an alternative for curtailment. GridMargin calculates both and shows the highest wholesale price at which running still makes sense.

The example is a 1.2 MW fleet. Clone the project and run the two manual prices in the README. Changing the price from 45 to 100 USD/MWh flips the decision. If you work with flexible loads, which cost should the next version model first?

https://github.com/ZQ051031/telegraph-hackathon-s2

## 2. Share the integration milestone

GridMargin’s live Telegraph testnet quote came back at 10,000 μUSDC for NP15. This is my Apps & Agents build for the prize-bearing Telegraph Season II hackathon.

The useful step was making the request typed. The agent discovers a CAISO price specialist, submits the hub and UTC settlement hour, and checks the escrow amount, network and resource in the HTTP 402 response. This run stopped at the quote and spent zero. You can reproduce it without a wallet using the quote command in the walkthrough. If your quote fails, I’d like to know the hub, UTC hour and status.

https://github.com/ZQ051031/telegraph-hackathon-s2/blob/main/docs/walkthrough.md

## 3. Show a paid result

GridMargin bought a day-ahead price on Telegraph testnet for [hub and UTC hour] and recommended [RUN or CURTAIL]. It’s my Apps & Agents entry for the prize-bearing Telegraph Season II hackathon.

The miner returned [observed USD/MWh], the receipt recorded [actual μUSDC], and the fleet model estimated [observed run net] against [observed curtail net]. The short demo shows the input, the autonomous purchase and the decision. Try the walkthrough with a different settlement hour. If you obtain an independent result, I’d welcome a reproduction note or a comparison against CAISO’s published price.

[Demo URL] · [Public delivery URL, if appropriate to share]

https://github.com/ZQ051031/telegraph-hackathon-s2
