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

## Safety Notes

- Use a dedicated wallet and keep balances small until you trust your setup.
- Always run `npm run health-check` before going live.
- Start with conservative sizing and monitor activity regularly.

## Disclaimer

This software is provided as-is with no guarantees. Trading involves risk and can lead to loss of funds. This is not financial advice.
