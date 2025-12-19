# Getting Started

This guide walks you from zero to a running copy-trading bot. Read everything once before funding a wallet.

## 1) Prerequisites

- Node.js 18+ installed
- A dedicated Polygon wallet (EOA or Gnosis Safe)
- USDC on Polygon and a small amount of POL (MATIC) for gas
- A Polygon RPC URL (Infura, Alchemy, etc.)
- MongoDB connection string (local or Atlas)

## 2) Install Dependencies

```bash
npm install
```

## 3) Create Your `.env`

Use the guided wizard:

```bash
npm run setup
```

Or copy the template and fill in values:

```bash
cp .env.example .env
```

Tips:

- `USER_ADDRESSES` accepts a comma-separated list or JSON array.
  - Example (comma): `USER_ADDRESSES='0xabc...,0xdef...'`
  - Example (JSON):  `USER_ADDRESSES='["0xabc...","0xdef..."]'`
- `PROXY_WALLET` is the wallet that will execute trades.
- `PRIVATE_KEY` should be the signing key for that wallet (or a Safe owner key).

## Proxy Wallet (Polymarket Profile Address)

If your Polymarket profile address differs from your MetaMask address, Polymarket created a proxy wallet (Gnosis Safe):

- Set `PROXY_WALLET` to the Polymarket profile address (the proxy).
- Fund the proxy address with USDC.e and POL (MATIC).
- Set `PRIVATE_KEY` to the EOA owner of the proxy.
- Run approvals:
  - `npm run check-allowance`
  - `npm run set-token-allowance`
  - These scripts can execute Safe transactions for a 1-of-1 Safe.
  - For multi-sig Safes, use the Safe UI to execute approvals.

## 4) Fund Your Wallet

Before running the bot:

- Bridge or deposit USDC to Polygon.
- Add a small amount of POL (MATIC) for gas.
- Start with a small balance until your strategy is validated.

## 5) Run the Health Check

```bash
npm run health-check
```

This validates:

- MongoDB connectivity
- RPC connectivity
- USDC balance
- Polymarket API availability

Fix any issues before proceeding.

## 6) Start the Bot

Development mode:

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

The bot will print a startup banner, run a health check, then begin monitoring traders.

## 7) Monitor & Operate

Useful commands:

- `npm run check-proxy` - wallet balances and positions
- `npm run check-allowance` / `npm run set-token-allowance`
- `npm run simulate` - backtest with historical data
- `npm run help` - full command list

Logs are written to `logs/bot-YYYY-MM-DD.log`.

## 8) Strategy Tuning (Optional)

Edit these in `.env` to adjust sizing and risk:

- `COPY_STRATEGY` (`PERCENTAGE`, `FIXED`, `ADAPTIVE`)
- `COPY_SIZE`
- `MAX_ORDER_SIZE_USD`, `MIN_ORDER_SIZE_USD`
- `MAX_POSITION_SIZE_USD`, `MAX_DAILY_VOLUME_USD`
- `TIERED_MULTIPLIERS` for size-based multipliers

See `.env.example` for examples.

## 9) Safety Checklist

- Use a dedicated wallet.
- Start small and monitor the bot.
- Re-run `npm run health-check` after any config changes.
- Keep your private key secure and never commit `.env`.

## Troubleshooting

- Missing env vars: ensure `.env` exists and matches `.env.example`.
- Invalid addresses: must be `0x` + 40 hex characters.
- MongoDB errors: verify Atlas IP whitelist and credentials.
- RPC errors: rotate to a different provider or API key.
