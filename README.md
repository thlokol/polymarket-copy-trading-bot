# Polymarket Copy Trading Bot

A TypeScript bot that monitors selected Polymarket traders and mirrors their trades on Polygon with configurable sizing, safety limits, and operational tooling.

## Highlights

- Copy trades from one or many trader wallets
- Multiple sizing strategies (percentage, fixed, adaptive)
- Risk controls: per-order, per-position, and daily volume caps
- Health checks, monitoring scripts, and simulation tools
- MongoDB-backed trade history and daily log files

## Quick Start

1) Install dependencies

```bash
npm install
```

2) Create your `.env`

- Run the wizard:

```bash
npm run setup
```

- Or copy and edit the template:

```bash
cp .env.example .env
```

3) Verify your setup

```bash
npm run health-check
```

4) Start the bot

```bash
npm run build
npm start
```

For a guided walkthrough, see `GETTING_STARTED.md`.

## Requirements

- Node.js 18+ (recommended)
- Polygon RPC endpoint
- MongoDB (local or Atlas)
- USDC on Polygon + a small amount of POL (MATIC) for gas
- A dedicated wallet/private key

## Configuration

The bot loads configuration from `.env` at startup. Required variables:

- `USER_ADDRESSES` - trader wallet(s) to copy (comma-separated or JSON array)
- `PROXY_WALLET` - your trading wallet (EOA or Gnosis Safe address)
- `PRIVATE_KEY` - private key for signing (use a dedicated wallet)
- `MONGO_URI` - MongoDB connection string
- `RPC_URL` - Polygon RPC URL
- `CLOB_HTTP_URL` - Polymarket CLOB HTTP endpoint
- `CLOB_WS_URL` - Polymarket CLOB WebSocket endpoint
- `USDC_CONTRACT_ADDRESS` - Polygon USDC contract address

See `.env.example` for all optional tuning parameters.

## Proxy Wallet Notes

Polymarket typically creates a proxy wallet (Gnosis Safe) for browser wallets. If your Polymarket profile shows a different address than your MetaMask address:

- Set `PROXY_WALLET` to the Polymarket profile address (the proxy).
- Keep funds (USDC.e + POL) in the proxy address, not the EOA.
- Set `PRIVATE_KEY` to the EOA owner of the proxy.
- Use `npm run check-allowance` and `npm run set-token-allowance` to approve spending.
  - These scripts can submit Safe transactions when the proxy is a 1-of-1 Safe.
  - For multi-sig Safes, use the Safe UI to execute the approval transactions.

## Common Commands

- `npm run setup` - interactive config wizard
- `npm run health-check` - validate DB/RPC/balance connectivity
- `npm run dev` - run in dev mode
- `npm start` - run compiled bot
- `npm run help` - list all available scripts

## Docker (Optional)

A `Dockerfile` and `docker-compose.yml` are provided.

```bash
cp .env.example .env
# edit .env, then:
docker compose up --build
```

## Logs & Data

- Daily logs: `logs/bot-YYYY-MM-DD.log`
- MongoDB stores trade history and analysis data

## Important: Trades vs Orders (API Limits)

This bot monitors Polymarket via `https://data-api.polymarket.com/activity?user=...&type=TRADE`, which returns **executed trades (fills)** — not "order intent" (placed limit order size, remaining quantity, open orders, etc).

- The Data API does **not** include an `orderId` in `TRADE` activities, and Polymarket's CLOB open-orders endpoints require the trader's authenticated API key, so the bot cannot reconstruct "the whole original order" for another user.
- One on-chain settlement transaction can include multiple fills at different prices (same `transactionHash`). The bot **aggregates** those into a single executed trade per market+side before copying.
- If a trader's order fills in parts **across different transactions** over time, the bot will mirror each transaction separately.

## Slippage Protection

### BUY Orders

The bot uses a dynamic slippage policy based on the original executed price:

| Zone | Price Range | Max Slippage | Behavior |
|------|-------------|--------------|----------|
| Death zone | > $0.95 | — | **Skipped** (too close to $1.00, little upside) |
| High zone | $0.80 – $0.95 | +$0.01 | Tight cap to avoid overpaying near certainty |
| Combat zone | $0.20 – $0.80 | +$0.03 | Moderate cap for typical trades |
| Zebra zone | < $0.20 | ×1.2 | Proportional cap to avoid paying 2x+ on cheap contracts |

All BUY orders are capped at a maximum price of $0.99.

### SELL Orders

SELL orders **do not have slippage protection**. The bot accepts the best available bid in the order book. This is intentional: when exiting a position, getting out is usually more important than optimizing the exit price.

## Safety Notes

- Use a dedicated wallet and keep balances small until you trust your setup.
- Always run `npm run health-check` before going live.
- Start with conservative sizing and monitor activity regularly.

## Disclaimer

This software is provided as-is with no guarantees. Trading involves risk and can lead to loss of funds. This is not financial advice.
