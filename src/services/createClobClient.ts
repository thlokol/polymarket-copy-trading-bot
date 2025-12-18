import { ethers } from 'ethers';
import { ClobClient } from '@polymarket/clob-client';
import { SignatureType } from '@polymarket/order-utils';
import { ENV } from '../config/env';

const PROXY_WALLET = ENV.PROXY_WALLET;
const PRIVATE_KEY = ENV.PRIVATE_KEY;
const CLOB_HTTP_URL = ENV.CLOB_HTTP_URL;

const createClobClient = async (): Promise<ClobClient> => {
    const chainId = 137;
    const host = CLOB_HTTP_URL as string;
    const wallet = new ethers.Wallet(PRIVATE_KEY as string);
    let clobClient = new ClobClient(
        host,
        chainId,
        wallet,
        undefined,
        SignatureType.POLY_PROXY,
        PROXY_WALLET as string
    );

    // Suppress console output during API key creation to avoid leaking credentials
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    console.log = function () {};
    console.error = function () {};
    let creds = await clobClient.createApiKey();
    if (!creds.key) {
        creds = await clobClient.deriveApiKey();
    }
    console.log = originalConsoleLog;
    console.error = originalConsoleError;

    clobClient = new ClobClient(
        host,
        chainId,
        wallet,
        creds,
        SignatureType.POLY_PROXY,
        PROXY_WALLET as string
    );
    return clobClient;
};

export default createClobClient;
