import { MarketLeader } from '../models/marketLeader';
import { IMarketLeader, LeaderCheckResult, TradeCandidate } from '../interfaces/MarketLeader';
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
                error instanceof Error &&
                'code' in error &&
                (error as { code: number }).code === 11000
            ) {
                const marketLabel = winner.slug || winner.title || `${winner.conditionId.slice(0, 8)}...`;
                Logger.warning(
                    `[Leader] Duplicate: leader already established for ${marketLabel} (${winner.conditionId.slice(0, 8)}...)`
                );
                return null;
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
     * Cleanup stale leaders that may have been orphaned.
     * Should be run on startup to handle cases where bot crashed mid-trade.
     * @param maxAgeHours Maximum age in hours before a leader is considered stale (default: 168 = 7 days)
     * @returns Number of cleaned up leaders
     */
    async cleanupStaleLeaders(maxAgeHours: number = 168): Promise<number> {
        const cutoffTime = Date.now() / 1000 - maxAgeHours * 60 * 60;

        const result = await MarketLeader.updateMany(
            {
                isActive: true,
                $or: [
                    { lastTradeTimestamp: { $lt: cutoffTime } },
                    {
                        lastTradeTimestamp: { $exists: false },
                        initialTradeTimestamp: { $lt: cutoffTime },
                    },
                ],
            },
            { $set: { isActive: false } }
        );

        return result.modifiedCount;
    }
}

// Export singleton instance
export const leaderService = new LeaderService();
