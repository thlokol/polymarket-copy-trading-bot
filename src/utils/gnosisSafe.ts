import { ethers } from 'ethers';

const SAFE_ABI = [
    'function getOwners() view returns (address[])',
    'function getThreshold() view returns (uint256)',
    'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)',
];

export interface SafeTransaction {
    to: string;
    data: string;
    value?: ethers.BigNumberish;
}

const buildPrevalidatedSignature = (owner: string): string => {
    const r = ethers.utils.hexZeroPad(owner, 32);
    const s = ethers.utils.hexZeroPad('0x0', 32);
    const v = '0x01';
    return ethers.utils.hexConcat([r, s, v]);
};

export const executeSafeTransaction = async (
    safeAddress: string,
    signer: ethers.Signer,
    tx: SafeTransaction,
    overrides: ethers.providers.TransactionRequest = {}
) => {
    const safe = new ethers.Contract(safeAddress, SAFE_ABI, signer);
    const owners: string[] = await safe.getOwners();
    const threshold = await safe.getThreshold();
    const signerAddress = await signer.getAddress();

    if (!owners.some((owner) => owner.toLowerCase() === signerAddress.toLowerCase())) {
        throw new Error(`Signer ${signerAddress} is not an owner of Safe ${safeAddress}`);
    }

    if (!threshold.eq(1)) {
        throw new Error(
            `Safe threshold ${threshold.toString()} is not supported by this script (needs 1-of-1)`
        );
    }

    const signatures = buildPrevalidatedSignature(signerAddress);
    return safe.execTransaction(
        tx.to,
        tx.value || 0,
        tx.data,
        0,
        0,
        0,
        0,
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        signatures,
        overrides
    );
};
