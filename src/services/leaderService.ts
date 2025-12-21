import { MarketLeader } from '../models/marketLeader';
import { IMarketLeader, LeaderCheckResult, TradeCandidate } from '../interfaces/MarketLeader';
import { UserPositionInterface } from '../interfaces/User';
import fetchData from '../utils/fetchData';
import Logger from '../utils/logger';

/**
 * Service for managing market leaders in the multi-user copy trading strategy.
 * Implements "Leader per market" strategy to resolve conflicting signals.
 */
class LeaderService {
    /**
     * Get the active leader for a specific market (conditionId)
     * @returns Leader record or null if no active leader
     */
    async getActiveLeader(conditionId: string): Promise<IMarketLeader | null> {
        const leader = await MarketLeader.findOne({
            conditionId,
            isActive: true,
        }).lean();

        return leader as IMarketLeader | null;
    }

    /**
     * Check if a user is the leader for a specific asset, or if leadership is available
     * @returns LeaderCheckResult with leadership status
     */
    async checkLeadership(
        conditionId: string,
        userAddress: string
    ): Promise<LeaderCheckResult> {
        const leader = await this.getActiveLeader(conditionId);

        if (!leader) {
            return {
                hasLeader: false,
                isLeader: false,
                currentLeader: null,
                reason: 'No active leader for this asset',
            };
        }

        const isLeader = leader.leaderAddress.toLowerCase() === userAddress.toLowerCase();

        return {
            hasLeader: true,
            isLeader,
            currentLeader: leader,
            reason: isLeader
                ? 'User is the current leader'
                : `Another user (${leader.leaderAddress.slice(0, 8)}...) is the leader`,
        };
    }

    /**
     * Establish a new leader for a market from competing candidates.
     * Only BUY trades are eligible to establish leadership.
     * Resolves simultaneous BUYs by selecting the LARGER trade (by usdcSize).
     * @returns The winning trade candidate, or null if leadership already exists
     */
    async establishLeader(candidates: TradeCandidate[]): Promise<TradeCandidate | null> {
        const buyCandidates = candidates.filter((c) => c.side === 'BUY');
        if (buyCandidates.length === 0) {
            return null;
        }

        // Sort by usdcSize descending - larger trade wins
        const sortedCandidates = [...buyCandidates].sort((a, b) => b.usdcSize - a.usdcSize);
        const winner = sortedCandidates[0];

        // Create new leader record
        try {
            await MarketLeader.create({
                conditionId: winner.conditionId,
                asset: winner.asset,
                leaderAddress: winner.userAddress.toLowerCase(),
                side: winner.side,
                initialTradeSize: winner.usdcSize,
                initialTradeTimestamp: winner.timestamp,
                lastTradeTimestamp: winner.timestamp,
                initialTransactionHash: winner.transactionHash,
                isActive: true,
                slug: winner.slug,
                title: winner.title,
            });

            const marketLabel = winner.slug || winner.title || `${winner.conditionId.slice(0, 8)}...`;
            Logger.success(
                `[Leader] Established ${winner.userAddress.slice(0, 8)}... for ${marketLabel} ` +
                    `(${winner.conditionId.slice(0, 8)}...) $${winner.usdcSize.toFixed(2)}`
            );

            return winner;
        } catch (error: unknown) {
            // Handle duplicate key error (another process already created leader)
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                (error as { code: number }).code === 11000
            ) {
                const duplicate = error as {
                    keyPattern?: Record<string, number>;
                    keyValue?: Record<string, string>;
                };
                const keyPattern = duplicate.keyPattern || {};
                const marketLabel = winner.slug || winner.title || `${winner.conditionId.slice(0, 8)}...`;
                if (keyPattern.conditionId && keyPattern.isActive) {
                    Logger.warning(
                        `[Leader] Duplicate: leader already established for ${marketLabel} (${winner.conditionId.slice(0, 8)}...)`
                    );
                    // Return the existing leader instead of null
                    const existingLeader = await this.getActiveLeader(winner.conditionId);
                    if (existingLeader) {
                        return {
                            userAddress: existingLeader.leaderAddress,
                            conditionId: existingLeader.conditionId,
                            asset: existingLeader.asset,
                            side: existingLeader.side,
                            usdcSize: existingLeader.initialTradeSize,
                            timestamp: existingLeader.initialTradeTimestamp,
                            transactionHash: existingLeader.initialTransactionHash,
                            slug: existingLeader.slug,
                            title: existingLeader.title,
                        } as TradeCandidate;
                    }
                    return null;
                }
                if (keyPattern.initialTransactionHash) {
                    Logger.warning(
                        `[Leader] Duplicate: transaction already tracked for ${marketLabel} (${winner.conditionId.slice(0, 8)}...)`
                    );
                    // Return the existing leader instead of null
                    const existingLeader = await this.getActiveLeader(winner.conditionId);
                    if (existingLeader) {
                        return {
                            userAddress: existingLeader.leaderAddress,
                            conditionId: existingLeader.conditionId,
                            asset: existingLeader.asset,
                            side: existingLeader.side,
                            usdcSize: existingLeader.initialTradeSize,
                            timestamp: existingLeader.initialTradeTimestamp,
                            transactionHash: existingLeader.initialTransactionHash,
                            slug: existingLeader.slug,
                            title: existingLeader.title,
                        } as TradeCandidate;
                    }
                    return null;
                }
                Logger.warning(
                    `[Leader] Duplicate key error establishing leader for ${marketLabel} (${winner.conditionId.slice(0, 8)}...)`
                );
            }
            throw error;
        }
    }

    /**
     * Release leadership when leader closes their position
     * @returns true if leadership was released, false if not found
     */
    async releaseLeadership(conditionId: string, leaderAddress: string): Promise<boolean> {
        const result = await MarketLeader.updateOne(
            {
                conditionId,
                leaderAddress: leaderAddress.toLowerCase(),
                isActive: true,
            },
            { $set: { isActive: false } }
        );

        if (result.modifiedCount > 0) {
            Logger.info(
                `[Leader] Released ${leaderAddress.slice(0, 8)}... for ${conditionId.slice(0, 8)}...`
            );
            return true;
        }

        return false;
    }

    /**
     * Record the latest trade timestamp for the active leader.
     */
    async recordLeaderTrade(
        conditionId: string,
        leaderAddress: string,
        timestamp: number
    ): Promise<void> {
        await MarketLeader.updateOne(
            {
                conditionId,
                leaderAddress: leaderAddress.toLowerCase(),
                isActive: true,
            },
            { $max: { lastTradeTimestamp: timestamp } }
        );
    }

    /**
     * Get all active leaders (useful for debugging/monitoring)
     */
    async getActiveLeaders(): Promise<IMarketLeader[]> {
        const leaders = await MarketLeader.find({ isActive: true }).lean();
        return leaders as IMarketLeader[];
    }

    /**
     * Cleanup leaders whose addresses are no longer in the tracked traders list.
     * Should be run on startup after changing USER_ADDRESSES in .env.
     * @param trackedAddresses List of currently tracked trader addresses
     * @returns Number of cleaned up leaders
     */
    async cleanupUnfollowedLeaders(trackedAddresses: string[]): Promise<number> {
        const normalizedAddresses = trackedAddresses.map((addr) => addr.toLowerCase());

        const unfollowedLeaders = await MarketLeader.find({
            isActive: true,
            leaderAddress: { $nin: normalizedAddresses },
        }).lean();

        if (unfollowedLeaders.length === 0) {
            return 0;
        }

        const result = await MarketLeader.updateMany(
            {
                isActive: true,
                leaderAddress: { $nin: normalizedAddresses },
            },
            { $set: { isActive: false } }
        );

        for (const leader of unfollowedLeaders) {
            const typedLeader = leader as IMarketLeader;
            const marketLabel =
                typedLeader.slug || typedLeader.title || `${typedLeader.conditionId.slice(0, 8)}...`;
            Logger.info(
                `[Leader] Released unfollowed ${typedLeader.leaderAddress.slice(0, 8)}... from ${marketLabel}`
            );
        }

        return result.modifiedCount;
    }

    /**
     * Cleanup stale leaders that may have been orphaned.
     * Should be run on startup to handle cases where bot crashed mid-trade.
     * @param maxAgeHours Maximum age in hours before a leader is considered stale (default: 168 = 7 days)
     * @returns Number of cleaned up leaders
     */
    async cleanupStaleLeaders(maxAgeHours: number = 168): Promise<number> {
        const cutoffTime = Date.now() / 1000 - maxAgeHours * 60 * 60;
        const staleLeaders = (await MarketLeader.find({
            isActive: true,
            $or: [
                { lastTradeTimestamp: { $lt: cutoffTime } },
                {
                    lastTradeTimestamp: { $exists: false },
                    initialTradeTimestamp: { $lt: cutoffTime },
                },
            ],
        }).lean()) as IMarketLeader[];

        if (staleLeaders.length === 0) {
            return 0;
        }

        const positionsCache = new Map<string, UserPositionInterface[] | null>();
        const DUST_THRESHOLD = 0.01;

        const getLeaderPositions = async (
            leaderAddress: string
        ): Promise<UserPositionInterface[] | null> => {
            const cacheKey = leaderAddress.toLowerCase();
            if (positionsCache.has(cacheKey)) {
                return positionsCache.get(cacheKey) || null;
            }
            try {
                const positions = await fetchData(
                    `https://data-api.polymarket.com/positions?user=${cacheKey}`
                );
                if (!Array.isArray(positions)) {
                    Logger.warning(
                        `[Leader] Unexpected positions response for ${cacheKey.slice(0, 8)}...`
                    );
                    positionsCache.set(cacheKey, null);
                    return null;
                }
                const typedPositions = positions as UserPositionInterface[];
                positionsCache.set(cacheKey, typedPositions);
                return typedPositions;
            } catch (error) {
                Logger.warning(
                    `[Leader] Failed to fetch positions for ${cacheKey.slice(0, 8)}...: ${error}`
                );
                positionsCache.set(cacheKey, null);
                return null;
            }
        };

        const releaseCandidates: Array<{ conditionId: string; leaderAddress: string }> = [];

        for (const leader of staleLeaders) {
            const positions = await getLeaderPositions(leader.leaderAddress);
            if (!positions) {
                continue;
            }

            const hasPosition = positions.some(
                (position) =>
                    position.conditionId === leader.conditionId &&
                    (position.size || 0) > DUST_THRESHOLD
            );

            if (!hasPosition) {
                releaseCandidates.push({
                    conditionId: leader.conditionId,
                    leaderAddress: leader.leaderAddress.toLowerCase(),
                });
            }
        }

        if (releaseCandidates.length === 0) {
            return 0;
        }

        const result = await MarketLeader.updateMany(
            {
                $or: releaseCandidates.map((candidate) => ({
                    conditionId: candidate.conditionId,
                    leaderAddress: candidate.leaderAddress,
                    isActive: true,
                })),
            },
            { $set: { isActive: false } }
        );

        return result.modifiedCount;
    }
}

// Export singleton instance
export const leaderService = new LeaderService();
