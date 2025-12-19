export interface IMarketLeader {
    conditionId: string; // Market identifier (leader is per conditionId)
    asset: string; // Initial token ID (YES/NO token) used to establish leadership
    leaderAddress: string; // Trader address (lowercase)
    side: 'BUY' | 'SELL'; // Initial trade side
    initialTradeSize: number; // USD size that established leadership
    initialTradeTimestamp: number; // When leadership was established (unix seconds)
    lastTradeTimestamp: number; // Latest leader trade timestamp (unix seconds)
    initialTransactionHash: string; // Reference to original trade
    isActive: boolean; // Whether leader still holds position
    slug?: string; // Market slug for logging
    title?: string; // Market title for logging
    createdAt?: Date;
    updatedAt?: Date;
}

export interface LeaderCheckResult {
    hasLeader: boolean;
    isLeader: boolean;
    currentLeader: IMarketLeader | null;
    reason: string;
}

export interface TradeCandidate {
    userAddress: string;
    conditionId: string;
    asset: string;
    side: 'BUY' | 'SELL';
    usdcSize: number;
    timestamp: number;
    transactionHash: string;
    slug?: string;
    title?: string;
}
