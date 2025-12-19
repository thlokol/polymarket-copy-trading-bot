import mongoose, { Schema } from 'mongoose';
import { IMarketLeader } from '../interfaces/MarketLeader';

const marketLeaderSchema = new Schema<IMarketLeader>(
    {
        conditionId: { type: String, required: true, index: true },
        asset: { type: String, required: true },
        leaderAddress: { type: String, required: true, lowercase: true },
        side: { type: String, enum: ['BUY', 'SELL'], required: true },
        initialTradeSize: { type: Number, required: true },
        initialTradeTimestamp: { type: Number, required: true },
        lastTradeTimestamp: { type: Number, required: true },
        initialTransactionHash: { type: String, required: true, unique: true },
        isActive: { type: Boolean, default: true, index: true },
        slug: { type: String, required: false },
        title: { type: String, required: false },
    },
    { timestamps: true }
);

// Enforce a single active leader per conditionId
marketLeaderSchema.index(
    { conditionId: 1, isActive: 1 },
    { unique: true, partialFilterExpression: { isActive: true } }
);

// Index for finding all active leaders by a specific trader
marketLeaderSchema.index({ leaderAddress: 1, isActive: 1 });

export const MarketLeader = mongoose.model<IMarketLeader>(
    'MarketLeader',
    marketLeaderSchema
);
