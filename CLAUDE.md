# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Polymarket copy trading bot that automatically mirrors trades from specified traders. It monitors trader activity via Polymarket Data API, calculates proportional position sizes, and executes matching orders using the Polymarket CLOB (Central Limit Order Book).

## Common Commands

```bash
# Development
npm run dev          # Run with ts-node (development mode)
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled JavaScript (production)

# Testing
npm test             # Run Jest tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run with coverage report

# Code Quality
npm run lint         # Run ESLint
npm run lint:fix     # Auto-fix lint issues
npm run format       # Format with Prettier

# Setup & Diagnostics
npm run setup        # Interactive setup wizard
npm run health-check # Verify configuration and connectivity

# Trading Scripts
npm run check-stats     # View your trading statistics
npm run check-allowance # Check USDC token allowance
npm run manual-sell     # Manually sell positions
npm run close-stale     # Close stale positions
npm run simulate        # Simulate profitability

# Trader Discovery
npm run find-traders    # Find profitable traders
npm run scan-traders    # Scan for best traders
npm run scan-markets    # Scan traders from active markets
```

## Architecture

### Core Services (src/services/)

**Trade Monitor** (`tradeMonitor.ts`):
- Polls Polymarket Data API at configurable intervals (default: 1s)
- Fetches trader activities from `https://data-api.polymarket.com/activity`
- Stores new trades in MongoDB with `bot: false` flag
- Updates trader position snapshots for PnL tracking

**Trade Executor** (`tradeExecutor.ts`):
- Processes trades marked as `bot: false` and `botExcutedTime: 0`
- Supports trade aggregation to combine small trades above Polymarket's $1 minimum
- Executes orders via `@polymarket/clob-client`

### Order Execution (src/utils/postOrder.ts)

Three execution modes:
- **BUY**: Calculates order size using copy strategy, fills against best asks
- **SELL**: Proportionally sells based on tracked purchase history (`myBoughtSize`)
- **MERGE**: Sells entire position (used when trader closes position)

Features slippage protection (5% max above trader's price) and retry logic.

### Copy Strategy System (src/config/copyStrategy.ts)

Three strategies for calculating copy amounts:
- `PERCENTAGE`: Copy fixed % of trader's order (recommended for beginners)
- `FIXED`: Copy fixed dollar amount per trade
- `ADAPTIVE`: Dynamic % based on trade size (higher % for small trades, lower for large)

Supports tiered multipliers for different order size ranges:
```
TIERED_MULTIPLIERS = "1-10:2.0,10-100:1.0,100-500:0.2,500+:0.1"
```

### Data Models (src/models/userHistory.ts)

MongoDB collections per tracked trader:
- `user_activities_{address}`: Trade history with `bot` flag for processing state
- `user_positions_{address}`: Current position snapshots

Key fields in activities:
- `bot: boolean` - True if trade has been processed
- `botExcutedTime: number` - Retry count (0 = not started, 999 = historical)
- `myBoughtSize: number` - Tracked tokens purchased (for accurate sell calculations)

### Configuration (src/config/env.ts)

Environment variables validated at startup. Required:
- `USER_ADDRESSES`: Comma-separated trader addresses to copy
- `PROXY_WALLET`: Your Polygon wallet address
- `PRIVATE_KEY`: Wallet private key (no 0x prefix)
- `MONGO_URI`: MongoDB connection string
- `RPC_URL`: Polygon RPC endpoint

## Key Dependencies

- `@polymarket/clob-client`: Official Polymarket order book client
- `ethers` (v5): Wallet signing and blockchain interactions
- `mongoose`: MongoDB ODM for trade/position storage
- `axios`: HTTP client for Polymarket Data API

## Testing

Tests located in `src/config/__tests__/`. Run single test file:
```bash
npx jest src/config/__tests__/copyStrategy.test.ts
```

## Important Patterns

1. **First-run behavior**: On startup, all historical trades are marked as processed (`bot: true, botExcutedTime: 999`) to avoid copying old trades.

2. **Trade deduplication**: Uses `transactionHash` to prevent processing the same trade twice.

3. **Position tracking**: `myBoughtSize` tracks actual tokens purchased for accurate sell amount calculations (compensates for balance changes between buy/sell).

4. **Graceful shutdown**: SIGTERM/SIGINT handlers stop monitor/executor and close DB connection.
