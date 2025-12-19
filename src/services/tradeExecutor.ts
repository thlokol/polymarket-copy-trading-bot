import { ClobClient } from '@polymarket/clob-client';
import { UserActivityInterface, UserPositionInterface } from '../interfaces/User';
import { TradeCandidate } from '../interfaces/MarketLeader';
import { ENV } from '../config/env';
import { BOT_START_TIMESTAMP } from '../config/runtime';
import { getUserActivityModel } from '../models/userHistory';
import { leaderService } from './leaderService';
import fetchData from '../utils/fetchData';
import getMyBalance from '../utils/getMyBalance';
import postOrder from '../utils/postOrder';
import Logger from '../utils/logger';

const USER_ADDRESSES = ENV.USER_ADDRESSES;
const RETRY_LIMIT = ENV.RETRY_LIMIT;
const PROXY_WALLET = ENV.PROXY_WALLET;
const TRADE_AGGREGATION_ENABLED = ENV.TRADE_AGGREGATION_ENABLED;
const TRADE_AGGREGATION_WINDOW_SECONDS = ENV.TRADE_AGGREGATION_WINDOW_SECONDS;
const TRADE_AGGREGATION_MIN_TOTAL_USD = 1.0; // Polymarket minimum
const LEADER_ELECTION_WINDOW_SECONDS = 2;
const BOT_EXECUTED_TIME_BUFFERED = 1;

// Create activity models for each user
const userActivityModels = USER_ADDRESSES.map((address) => ({
    address,
    model: getUserActivityModel(address),
}));

interface TradeWithUser extends UserActivityInterface {
    userAddress: string;
}

interface AggregatedTrade {
    userAddress: string;
    conditionId: string;
    asset: string;
    side: string;
    slug?: string;
    eventSlug?: string;
    trades: TradeWithUser[];
    totalUsdcSize: number;
    averagePrice: number;
    firstTradeTime: number;
    lastTradeTime: number;
}

const shortAddress = (address: string): string => `${address.slice(0, 8)}...`;

const formatMarketLabel = (trade: TradeWithUser, conditionId: string): string => {
    if (trade.slug) return trade.slug;
    if (trade.title) return trade.title;
    return `${conditionId.slice(0, 8)}...`;
};

const getTradeTimestamp = (trade: TradeWithUser): number =>
    typeof trade.timestamp === 'number' ? trade.timestamp : 0;

// Buffer for aggregating trades
const tradeAggregationBuffer: Map<string, AggregatedTrade> = new Map();

const readTempTrades = async (): Promise<TradeWithUser[]> => {
    const allTrades: TradeWithUser[] = [];

    for (const { address, model } of userActivityModels) {
        // Only get trades that haven't been processed yet (bot: false AND botExcutedTime: 0)
        // This prevents processing the same trade multiple times
        const trades = await model
            .find({
                $and: [
                    { type: 'TRADE' },
                    { bot: false },
                    { botExcutedTime: 0 },
                    { timestamp: { $gte: BOT_START_TIMESTAMP } },
                ],
            })
            .sort({ timestamp: 1 })
            .exec();

        const tradesWithUser = trades.map((trade) => ({
            ...(trade.toObject() as UserActivityInterface),
            userAddress: address,
        }));

        allTrades.push(...tradesWithUser);
    }

    return allTrades;
};

/**
 * Process trades based on leader-per-market strategy.
 * Trades are handled in timestamp order to respect sequence and allow leader changes.
 */
const sortTradesByTimestamp = (a: TradeWithUser, b: TradeWithUser): number => {
    const aTimestamp = getTradeTimestamp(a);
    const bTimestamp = getTradeTimestamp(b);
    if (aTimestamp !== bTimestamp) return aTimestamp - bTimestamp;
    return (b.usdcSize || 0) - (a.usdcSize || 0);
};

const sortTradesBySide = (a: TradeWithUser, b: TradeWithUser): number => {
    if (a.side === b.side) return 0;
    if (a.side === 'BUY') return -1;
    if (b.side === 'BUY') return 1;
    return 0;
};

const sortLeaderTrades = (a: TradeWithUser, b: TradeWithUser): number => {
    const aTimestamp = getTradeTimestamp(a);
    const bTimestamp = getTradeTimestamp(b);
    if (aTimestamp !== bTimestamp) return aTimestamp - bTimestamp;

    const side = sortTradesBySide(a, b);
    if (side !== 0) return side;

    return (b.usdcSize || 0) - (a.usdcSize || 0);
};

const markTradeSkipped = async (trade: TradeWithUser, reasonCode: number): Promise<void> => {
    const UserActivity = getUserActivityModel(trade.userAddress);
    await UserActivity.updateOne(
        { _id: trade._id },
        { $set: { bot: true, botExcutedTime: reasonCode } }
    );
};

const markTradeBuffered = async (trade: TradeWithUser): Promise<void> => {
    const UserActivity = getUserActivityModel(trade.userAddress);
    await UserActivity.updateOne(
        { _id: trade._id, bot: false, botExcutedTime: 0 },
        { $set: { botExcutedTime: BOT_EXECUTED_TIME_BUFFERED } }
    );
};

const handleAcceptedTrade = async (clobClient: ClobClient, trade: TradeWithUser): Promise<void> => {
    if (
        TRADE_AGGREGATION_ENABLED &&
        trade.side === 'BUY' &&
        trade.usdcSize < TRADE_AGGREGATION_MIN_TOTAL_USD
    ) {
        await markTradeBuffered(trade);
        Logger.info(
            `Adding $${trade.usdcSize.toFixed(2)} ${trade.side} trade to aggregation buffer for ${trade.slug || trade.asset}`
        );
        addToAggregationBuffer(trade);
        return;
    }

    if (TRADE_AGGREGATION_ENABLED) {
        Logger.clearLine();
        Logger.header(`⚡ IMMEDIATE TRADE (above threshold)`);
    }

    await doTrading(clobClient, [trade]);
};

const processTradesByLeader = async (
    clobClient: ClobClient,
    trades: TradeWithUser[]
): Promise<{
    acceptedCount: number;
    skippedCount: number;
}> => {
    const tradeGroups = new Map<string, TradeWithUser[]>();
    let acceptedCount = 0;
    let skippedCount = 0;

    for (const trade of trades) {
        const key = trade.conditionId;
        const existing = tradeGroups.get(key) || [];
        existing.push(trade);
        tradeGroups.set(key, existing);
    }

    for (const [conditionId, groupTrades] of tradeGroups.entries()) {
        const sortedTrades = [...groupTrades].sort(sortTradesByTimestamp);
        let index = 0;

        while (index < sortedTrades.length) {
            const timestamp = getTradeTimestamp(sortedTrades[index]);
            const windowEnd = timestamp + LEADER_ELECTION_WINDOW_SECONDS;
            const sameTimeTrades: TradeWithUser[] = [];

            while (
                index < sortedTrades.length &&
                getTradeTimestamp(sortedTrades[index]) <= windowEnd
            ) {
                sameTimeTrades.push(sortedTrades[index]);
                index += 1;
            }

            let activeLeader = await leaderService.getActiveLeader(conditionId);
            let leaderAddress = activeLeader?.leaderAddress.toLowerCase() || null;

            if (!leaderAddress) {
                const buyTrades = sameTimeTrades.filter((trade) => trade.side === 'BUY');

                if (buyTrades.length === 0) {
                    const marketLabel = formatMarketLabel(sameTimeTrades[0], conditionId);
                    Logger.warning(
                        `[Skipped] No BUY trades to establish leader for ${marketLabel} (${conditionId.slice(0, 8)}...)`
                    );
                    for (const trade of sameTimeTrades) {
                        skippedCount += 1;
                        await markTradeSkipped(trade, -2);
                    }
                    continue;
                }

                const candidates: TradeCandidate[] = buyTrades.map((trade) => ({
                    userAddress: trade.userAddress,
                    conditionId: trade.conditionId,
                    asset: trade.asset,
                    side: (trade.side as 'BUY' | 'SELL') || 'BUY',
                    usdcSize: trade.usdcSize,
                    timestamp: trade.timestamp,
                    transactionHash: trade.transactionHash,
                    slug: trade.slug,
                    title: trade.title,
                }));

                const winner = await leaderService.establishLeader(candidates);
                if (winner) {
                    leaderAddress = winner.userAddress.toLowerCase();
                } else {
                    activeLeader = await leaderService.getActiveLeader(conditionId);
                    leaderAddress = activeLeader?.leaderAddress.toLowerCase() || null;
                }

                if (!leaderAddress) {
                    const marketLabel = formatMarketLabel(sameTimeTrades[0], conditionId);
                    for (const trade of sameTimeTrades) {
                        skippedCount += 1;
                        Logger.warning(
                            `[Skipped] ${shortAddress(trade.userAddress)} ignored for ${marketLabel} ` +
                                `(reason: leader not established)`
                        );
                        await markTradeSkipped(trade, -1);
                    }
                    continue;
                }
            }
            const leaderTrades = sameTimeTrades
                .filter((trade) => trade.userAddress.toLowerCase() === leaderAddress)
                .sort(sortLeaderTrades);
            const nonLeaderTrades = sameTimeTrades.filter(
                (trade) => trade.userAddress.toLowerCase() !== leaderAddress
            );

            for (const trade of leaderTrades) {
                acceptedCount += 1;
                await leaderService.recordLeaderTrade(conditionId, trade.userAddress, trade.timestamp);
                const marketLabel = formatMarketLabel(trade, conditionId);
                Logger.info(
                    `[Leader] ${shortAddress(trade.userAddress)} accepted for ${marketLabel} (${conditionId.slice(0, 8)}...)`
                );
                await handleAcceptedTrade(clobClient, trade);
            }

            for (const trade of nonLeaderTrades) {
                skippedCount += 1;
                const marketLabel = formatMarketLabel(trade, conditionId);
                Logger.warning(
                    `[Skipped] ${shortAddress(trade.userAddress)} ignored for ${marketLabel} ` +
                        `(leader: ${shortAddress(leaderAddress)}, reason: not leader)`
                );
                await markTradeSkipped(trade, -1);
            }
        }
    }

    return { acceptedCount, skippedCount };
};

/**
 * Generate a unique key for trade aggregation based on user, market, side
 */
const getAggregationKey = (trade: TradeWithUser): string => {
    return `${trade.userAddress}:${trade.conditionId}:${trade.asset}:${trade.side}`;
};

/**
 * Add trade to aggregation buffer or update existing aggregation
 */
const addToAggregationBuffer = (trade: TradeWithUser): void => {
    const key = getAggregationKey(trade);
    const existing = tradeAggregationBuffer.get(key);
    const now = Date.now();

    if (existing) {
        const tradeId = String(trade._id);
        const alreadyBuffered = existing.trades.some((t) => String(t._id) === tradeId);
        if (alreadyBuffered) {
            return;
        }
        // Update existing aggregation
        existing.trades.push(trade);
        existing.totalUsdcSize += trade.usdcSize;
        // Recalculate weighted average price
        const totalValue = existing.trades.reduce((sum, t) => sum + t.usdcSize * t.price, 0);
        existing.averagePrice = totalValue / existing.totalUsdcSize;
        existing.lastTradeTime = now;
    } else {
        // Create new aggregation
        tradeAggregationBuffer.set(key, {
            userAddress: trade.userAddress,
            conditionId: trade.conditionId,
            asset: trade.asset,
            side: trade.side || 'BUY',
            slug: trade.slug,
            eventSlug: trade.eventSlug,
            trades: [trade],
            totalUsdcSize: trade.usdcSize,
            averagePrice: trade.price,
            firstTradeTime: now,
            lastTradeTime: now,
        });
    }
};

/**
 * Check buffer and return ready aggregated trades
 * Trades are ready if:
 * 1. Total size >= minimum AND
 * 2. Time window has passed since first trade
 */
const getReadyAggregatedTrades = async (): Promise<AggregatedTrade[]> => {
    const ready: AggregatedTrade[] = [];
    const now = Date.now();
    const windowMs = TRADE_AGGREGATION_WINDOW_SECONDS * 1000;
    const leaderCache = new Map<string, string | null>();

    const getLeaderAddress = async (conditionId: string): Promise<string | null> => {
        if (leaderCache.has(conditionId)) {
            return leaderCache.get(conditionId) || null;
        }
        const leader = await leaderService.getActiveLeader(conditionId);
        const leaderAddress = leader?.leaderAddress.toLowerCase() || null;
        leaderCache.set(conditionId, leaderAddress);
        return leaderAddress;
    };

    for (const [key, agg] of tradeAggregationBuffer.entries()) {
        const leaderAddress = await getLeaderAddress(agg.conditionId);
        const aggLeader = agg.userAddress.toLowerCase();
        if (!leaderAddress || leaderAddress !== aggLeader) {
            Logger.warning(
                `[Aggregation] Dropping buffered trade(s) for ${agg.slug || agg.asset} ` +
                    `(${agg.conditionId.slice(0, 8)}...) due to leader change`
            );
            for (const trade of agg.trades) {
                await markTradeSkipped(trade, -1);
            }
            tradeAggregationBuffer.delete(key);
            continue;
        }

        const timeElapsed = now - agg.firstTradeTime;

        // Check if aggregation is ready
        if (timeElapsed >= windowMs) {
            if (agg.totalUsdcSize >= TRADE_AGGREGATION_MIN_TOTAL_USD) {
                // Aggregation meets minimum and window passed - ready to execute
                ready.push(agg);
            } else {
                // Window passed but total too small - mark individual trades as skipped
                Logger.info(
                    `Trade aggregation for ${agg.userAddress} on ${agg.slug || agg.asset}: $${agg.totalUsdcSize.toFixed(2)} total from ${agg.trades.length} trades below minimum ($${TRADE_AGGREGATION_MIN_TOTAL_USD}) - skipping`
                );

                // Mark all trades in this aggregation as processed (bot: true)
                for (const trade of agg.trades) {
                    const UserActivity = getUserActivityModel(trade.userAddress);
                    await UserActivity.updateOne({ _id: trade._id }, { bot: true });
                }
            }
            // Remove from buffer either way
            tradeAggregationBuffer.delete(key);
        }
    }

    return ready;
};

const doTrading = async (clobClient: ClobClient, trades: TradeWithUser[]) => {
    for (const trade of trades) {
        // Mark trade as being processed immediately to prevent duplicate processing
        const UserActivity = getUserActivityModel(trade.userAddress);
        await UserActivity.updateOne({ _id: trade._id }, { $set: { botExcutedTime: 1 } });

        Logger.trade(trade.userAddress, trade.side || 'UNKNOWN', {
            asset: trade.asset,
            side: trade.side,
            amount: trade.usdcSize,
            price: trade.price,
            slug: trade.slug,
            eventSlug: trade.eventSlug,
            transactionHash: trade.transactionHash,
        });

        const my_positions: UserPositionInterface[] = await fetchData(
            `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`
        );
        const user_positions: UserPositionInterface[] = await fetchData(
            `https://data-api.polymarket.com/positions?user=${trade.userAddress}`
        );
        const my_position = my_positions.find(
            (position: UserPositionInterface) => position.conditionId === trade.conditionId
        );
        const user_position = user_positions.find(
            (position: UserPositionInterface) => position.conditionId === trade.conditionId
        );

        // Get USDC balance
        const my_balance = await getMyBalance(PROXY_WALLET);

        // Calculate trader's total portfolio value from positions
        const user_balance = user_positions.reduce((total, pos) => {
            return total + (pos.currentValue || 0);
        }, 0);

        Logger.balance(my_balance, user_balance, trade.userAddress);

        // Execute the trade
        await postOrder(
            clobClient,
            trade.side === 'BUY' ? 'buy' : 'sell',
            my_position,
            user_position,
            trade,
            my_balance,
            user_balance,
            trade.userAddress
        );

        Logger.separator();
    }
};

/**
 * Execute aggregated trades
 */
const doAggregatedTrading = async (clobClient: ClobClient, aggregatedTrades: AggregatedTrade[]) => {
    for (const agg of aggregatedTrades) {
        Logger.header(`📊 AGGREGATED TRADE (${agg.trades.length} trades combined)`);
        Logger.info(`Market: ${agg.slug || agg.asset}`);
        Logger.info(`Side: ${agg.side}`);
        Logger.info(`Total volume: $${agg.totalUsdcSize.toFixed(2)}`);
        Logger.info(`Average price: $${agg.averagePrice.toFixed(4)}`);

        // Mark all individual trades as being processed
        for (const trade of agg.trades) {
            const UserActivity = getUserActivityModel(trade.userAddress);
            await UserActivity.updateOne({ _id: trade._id }, { $set: { botExcutedTime: 1 } });
        }

        const my_positions: UserPositionInterface[] = await fetchData(
            `https://data-api.polymarket.com/positions?user=${PROXY_WALLET}`
        );
        const user_positions: UserPositionInterface[] = await fetchData(
            `https://data-api.polymarket.com/positions?user=${agg.userAddress}`
        );
        const my_position = my_positions.find(
            (position: UserPositionInterface) => position.conditionId === agg.conditionId
        );
        const user_position = user_positions.find(
            (position: UserPositionInterface) => position.conditionId === agg.conditionId
        );

        // Get USDC balance
        const my_balance = await getMyBalance(PROXY_WALLET);

        // Calculate trader's total portfolio value from positions
        const user_balance = user_positions.reduce((total, pos) => {
            return total + (pos.currentValue || 0);
        }, 0);

        Logger.balance(my_balance, user_balance, agg.userAddress);

        // Create a synthetic trade object for postOrder using aggregated values
        const syntheticTrade: UserActivityInterface = {
            ...agg.trades[0], // Use first trade as template
            usdcSize: agg.totalUsdcSize,
            price: agg.averagePrice,
            side: agg.side as 'BUY' | 'SELL',
        };

        // Execute the aggregated trade
        await postOrder(
            clobClient,
            agg.side === 'BUY' ? 'buy' : 'sell',
            my_position,
            user_position,
            syntheticTrade,
            my_balance,
            user_balance,
            agg.userAddress
        );

        // Mark all underlying trades as processed (postOrder only updates one _id)
        const UserActivity = getUserActivityModel(agg.userAddress);
        await UserActivity.updateMany(
            { _id: { $in: agg.trades.map((t) => t._id) } },
            { $set: { bot: true } }
        );

        Logger.separator();
    }
};

// Track if executor should continue running
let isRunning = true;

/**
 * Stop the trade executor gracefully
 */
export const stopTradeExecutor = () => {
    isRunning = false;
    Logger.info('Trade executor shutdown requested...');
};

const tradeExecutor = async (clobClient: ClobClient) => {
    Logger.success(`Trade executor ready for ${USER_ADDRESSES.length} trader(s)`);
    if (TRADE_AGGREGATION_ENABLED) {
        Logger.info(
            `Trade aggregation enabled: ${TRADE_AGGREGATION_WINDOW_SECONDS}s window, $${TRADE_AGGREGATION_MIN_TOTAL_USD} minimum`
        );
    }

    let lastCheck = Date.now();
    while (isRunning) {
        const rawTrades = await readTempTrades();

        if (TRADE_AGGREGATION_ENABLED) {
            if (rawTrades.length > 0) {
                Logger.clearLine();
                Logger.info(
                    `📥 ${rawTrades.length} new trade${rawTrades.length > 1 ? 's' : ''} detected`
                );
                const { acceptedCount, skippedCount } = await processTradesByLeader(
                    clobClient,
                    rawTrades
                );
                if (skippedCount > 0) {
                    Logger.info(`Skipped ${skippedCount} trade(s) due to leader conflicts`);
                }
                if (acceptedCount > 0 || skippedCount > 0) {
                    lastCheck = Date.now();
                }
            }

            // Check for ready aggregated trades
            const readyAggregations = await getReadyAggregatedTrades();
            if (readyAggregations.length > 0) {
                Logger.clearLine();
                Logger.header(
                    `⚡ ${readyAggregations.length} AGGREGATED TRADE${readyAggregations.length > 1 ? 'S' : ''} READY`
                );
                await doAggregatedTrading(clobClient, readyAggregations);
                lastCheck = Date.now();
            }

            // Update waiting message
            if (rawTrades.length === 0 && readyAggregations.length === 0) {
                if (Date.now() - lastCheck > 300) {
                    const bufferedCount = tradeAggregationBuffer.size;
                    if (bufferedCount > 0) {
                        Logger.waiting(
                            USER_ADDRESSES.length,
                            `${bufferedCount} trade group(s) pending`
                        );
                    } else {
                        Logger.waiting(USER_ADDRESSES.length);
                    }
                    lastCheck = Date.now();
                }
            }
        } else {
            if (rawTrades.length > 0) {
                Logger.clearLine();
                Logger.header(
                    `⚡ ${rawTrades.length} NEW TRADE${rawTrades.length > 1 ? 'S' : ''} TO COPY`
                );
                const { acceptedCount, skippedCount } = await processTradesByLeader(
                    clobClient,
                    rawTrades
                );
                if (skippedCount > 0) {
                    Logger.info(`Skipped ${skippedCount} trade(s) due to leader conflicts`);
                }
                if (acceptedCount > 0 || skippedCount > 0) {
                    lastCheck = Date.now();
                }
            } else {
                // Update waiting message every 300ms for smooth animation
                if (Date.now() - lastCheck > 300) {
                    Logger.waiting(USER_ADDRESSES.length);
                    lastCheck = Date.now();
                }
            }
        }

        if (!isRunning) break;
        await new Promise((resolve) => setTimeout(resolve, 300));
    }

    Logger.info('Trade executor stopped');
};

export default tradeExecutor;
