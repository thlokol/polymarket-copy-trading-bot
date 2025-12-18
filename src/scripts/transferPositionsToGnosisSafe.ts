import { ethers } from 'ethers';
import { ENV } from '../config/env';
import fetchData from '../utils/fetchData';
import * as readline from 'readline';

const PRIVATE_KEY = ENV.PRIVATE_KEY;
const RPC_URL = ENV.RPC_URL;

// Polymarket Conditional Tokens contract on Polygon (ERC1155)
const CONDITIONAL_TOKENS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

interface Position {
    asset: string;
    conditionId: string;
    size: number;
    avgPrice: number;
    currentValue: number;
    cashPnl: number;
    percentPnl: number;
    curPrice: number;
    title?: string;
    slug?: string;
    outcome?: string;
}

const isValidEthereumAddress = (address: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(address);

const ask = (question: string): Promise<string> => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) =>
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        })
    );
};

async function transferPositions() {
    console.log('\n🔄 TRANSFERRING POSITIONS FROM EOA TO GNOSIS SAFE\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const gnosisSafeAddress =
        (process.env.TRANSFER_TO_ADDRESS || process.env.GNOSIS_SAFE_ADDRESS || '').trim();

    if (!gnosisSafeAddress) {
        console.log('❌ Recipient address not specified (Gnosis Safe)');
        console.log('   Specify environment variable: TRANSFER_TO_ADDRESS=0x...');
        console.log('   Example: TRANSFER_TO_ADDRESS=0xYourSafe npm run transfer-to-gnosis\n');
        process.exit(1);
    }

    if (!isValidEthereumAddress(gnosisSafeAddress)) {
        console.log('❌ Invalid recipient address:', gnosisSafeAddress);
        process.exit(1);
    }

    console.log('📍 Addresses:\n');
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const eoaAddress = wallet.address;

    console.log(`   FROM (EOA):          ${eoaAddress}`);
    console.log(`   TO (Gnosis Safe):    ${gnosisSafeAddress}\n`);

    if (process.env.CONFIRM_TRANSFER !== 'true') {
        console.log('⚠️  WARNING: this script can move your positions/funds.');
        const confirmation = await ask(
            `Enter recipient address for confirmation (${gnosisSafeAddress}): `
        );
        if (confirmation.toLowerCase() !== gnosisSafeAddress.toLowerCase()) {
            console.log('❌ Confirmation did not match. Cancelled.');
            process.exit(1);
        }
        console.log('✅ Confirmed.\n');
    }

    // 1. Get all positions on EOA
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 1: Getting positions on EOA\n');

    const positions: Position[] = await fetchData(
        `https://data-api.polymarket.com/positions?user=${eoaAddress}`
    );

    if (!positions || positions.length === 0) {
        console.log('❌ No positions on EOA to transfer\n');
        return;
    }

    console.log(`✅ Found positions: ${positions.length}`);
    console.log(
        `💰 Total value: $${positions.reduce((s, p) => s + p.currentValue, 0).toFixed(2)}\n`
    );

    // 2. Connect to network
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 2: Connecting to Polygon\n');

    console.log(`✅ Connected to Polygon\n`);
    console.log(`   Wallet: ${wallet.address}\n`);

    // 3. ERC1155 ABI for safeTransferFrom
    const erc1155Abi = [
        'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
        'function balanceOf(address account, uint256 id) view returns (uint256)',
        'function isApprovedForAll(address account, address operator) view returns (bool)',
        'function setApprovalForAll(address operator, bool approved)',
    ];

    // 4. Transfer each position
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 3: Transferring positions\n');

    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];

        console.log(`\n📦 Position ${i + 1}/${positions.length}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Market: ${pos.title || 'Unknown'}`);
        console.log(`Outcome: ${pos.outcome || 'Unknown'}`);
        console.log(`Size: ${pos.size.toFixed(2)} shares`);
        console.log(`Value: $${pos.currentValue.toFixed(2)}`);
        console.log(`Token ID: ${pos.asset.slice(0, 20)}...`);

        try {
            // Conditional Tokens contract (stores ERC1155 tokens)
            const ctfContract = new ethers.Contract(CONDITIONAL_TOKENS, erc1155Abi, wallet);

            // Check balance on EOA
            const balance = await ctfContract.balanceOf(eoaAddress, pos.asset);
            console.log(`\n📊 Balance on EOA: ${ethers.utils.formatUnits(balance, 0)} tokens`);

            if (balance.isZero()) {
                console.log('⚠️  Skip: Balance is zero\n');
                failureCount++;
                continue;
            }

            // Get gas price
            const gasPrice = await provider.getGasPrice();
            const gasPriceWithBuffer = gasPrice.mul(150).div(100); // +50% buffer

            console.log(
                `⛽ Gas price: ${ethers.utils.formatUnits(gasPriceWithBuffer, 'gwei')} Gwei\n`
            );

            // Transfer tokens
            console.log(`🔄 Transferring ${ethers.utils.formatUnits(balance, 0)} tokens...`);

            const transferTx = await ctfContract.safeTransferFrom(
                eoaAddress,
                gnosisSafeAddress,
                pos.asset,
                balance,
                '0x', // empty data
                {
                    gasPrice: gasPriceWithBuffer,
                    gasLimit: 200000,
                }
            );

            console.log(`⏳ TX sent: ${transferTx.hash}`);
            console.log('⏳ Waiting for confirmation...');

            const receipt = await transferTx.wait();

            console.log(`✅ SUCCESS! Block: ${receipt.blockNumber}`);
            console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

            successCount++;

            // Pause between transfers
            if (i < positions.length - 1) {
                console.log('\n⏳ Pause 3 seconds...\n');
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
        } catch (error: any) {
            console.log(`\n❌ ERROR during transfer:`);
            console.log(`   ${error.message}\n`);
            failureCount++;
        }
    }

    // 5. Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 TRANSFER SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`✅ Successfully transferred: ${successCount}/${positions.length}`);
    console.log(`❌ Errors: ${failureCount}/${positions.length}\n`);

    // 6. Check result
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 STEP 4: Checking result\n');

    console.log('⏳ Waiting 5 seconds for API data update...\n');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const eoaPositionsAfter: Position[] = await fetchData(
        `https://data-api.polymarket.com/positions?user=${eoaAddress}`
    );

    const gnosisPositionsAfter: Position[] = await fetchData(
        `https://data-api.polymarket.com/positions?user=${gnosisSafeAddress}`
    );

    console.log('📊 AFTER TRANSFER:\n');
    console.log(`   EOA:          ${eoaPositionsAfter?.length || 0} positions`);
    console.log(`   Gnosis Safe:  ${gnosisPositionsAfter?.length || 0} positions\n`);

    if (gnosisPositionsAfter && gnosisPositionsAfter.length > 0) {
        console.log('✅ Positions successfully transferred to Gnosis Safe!\n');
        console.log('🔗 Check on Polymarket:\n');
        console.log(`   https://polymarket.com/profile/${gnosisSafeAddress}\n`);
    } else {
        console.log('⚠️  API not updated yet. Wait a few minutes and check manually.\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('✅ Script completed!\n');
}

transferPositions().catch((error) => {
    console.error('\n❌ Critical error:', error);
    process.exit(1);
});
