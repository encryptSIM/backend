"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SolanaService = void 0;
const web3_js_1 = require("@solana/web3.js");
const axios_1 = __importDefault(require("axios"));
class SolanaService {
    constructor() {
        const rpcUrl = process.env.SOLANA_RPC_URL;
        if (!rpcUrl) {
            throw new Error('SOLANA_RPC_URL environment variable is not set.');
        }
        this.connection = new web3_js_1.Connection(rpcUrl);
        this.masterPublicKey = new web3_js_1.PublicKey(process.env.SOLANA_MASTER_PK || "");
    }
    createNewSolanaWallet() {
        return __awaiter(this, void 0, void 0, function* () {
            const newWallet = web3_js_1.Keypair.generate();
            const publicKey = newWallet.publicKey.toBase58();
            const privateKey = JSON.stringify(Array.from(newWallet.secretKey));
            return { publicKey, privateKey };
        });
    }
    checkSolanaPayment(address, expectedAmountUSD) {
        return __awaiter(this, void 0, void 0, function* () {
            // Convert expected amount from string to number
            const expectedAmountUSDNumber = parseFloat(expectedAmountUSD);
            const publicKey = new web3_js_1.PublicKey(address);
            const balance = yield this.connection.getBalance(publicKey);
            const solBalance = balance / web3_js_1.LAMPORTS_PER_SOL;
            // Fetch SOL price from Coingecko
            const solPrice = yield this.fetchSolPrice();
            console.log("solPrice: ", solPrice);
            if (!solPrice) {
                throw new Error("Could not fetch SOL price");
            }
            // Convert expected amount in USD to SOL
            const expectedAmountSOL = expectedAmountUSDNumber / solPrice;
            const enoughReceived = solBalance >= expectedAmountSOL;
            return { enoughReceived, solBalance };
        });
    }
    fetchSolPrice() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const response = yield axios_1.default.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
                console.log("fetch: ", response);
                return response.data.solana.usd;
            }
            catch (error) {
                console.error('Error fetching SOL price from Coingecko:', error);
                return null;
            }
        });
    }
    aggregatePaymentToMasterWallet(sourcePrivateKey, amount) {
        return __awaiter(this, void 0, void 0, function* () {
            const sourceWallet = web3_js_1.Keypair.fromSecretKey(new Uint8Array(JSON.parse(sourcePrivateKey)));
            const lamports = amount * web3_js_1.LAMPORTS_PER_SOL;
            const transaction = new web3_js_1.Transaction().add(web3_js_1.SystemProgram.transfer({
                fromPubkey: sourceWallet.publicKey,
                toPubkey: this.masterPublicKey,
                lamports: lamports,
            }));
            const maxSendRetries = 5;
            const sendRetryInterval = 2000; // 2 seconds
            const maxConfirmRetries = 5;
            const confirmRetryInterval = 2000; // 2 seconds
            let signature;
            let sendError;
            // Retry sending the transaction
            for (let i = 0; i < maxSendRetries; i++) {
                try {
                    console.log(`Attempt ${i + 1} to send transaction...`);
                    signature = yield this.connection.sendTransaction(transaction, [sourceWallet]);
                    console.log(`Transaction sent with signature: ${signature}`);
                    sendError = undefined; // Clear any previous send error
                    break; // Exit send retry loop on success
                }
                catch (error) {
                    sendError = error;
                    console.error(`Error sending transaction on attempt ${i + 1}:`, error);
                    if (i < maxSendRetries - 1) {
                        console.log(`Retrying send in ${sendRetryInterval / 1000} seconds...`);
                        yield new Promise(resolve => setTimeout(resolve, sendRetryInterval));
                    }
                }
            }
            if (sendError || !signature) {
                throw new Error(`Failed to send transaction after ${maxSendRetries} retries: ${(sendError === null || sendError === void 0 ? void 0 : sendError.message) || 'Unknown error'}`);
            }
            // Retry confirming the transaction
            for (let i = 0; i < maxConfirmRetries; i++) {
                try {
                    console.log(`Attempt ${i + 1} to confirm transaction ${signature}...`);
                    const status = yield this.connection.confirmTransaction(signature, 'finalized');
                    // Check if the transaction is finalized
                    if (status.value.err === null) {
                        console.log(`Transaction ${signature} finalized.`);
                        return signature; // Return signature on successful finalization
                    }
                    else {
                        console.warn(`Transaction ${signature} failed to finalize on attempt ${i + 1}:`, status.value.err);
                    }
                }
                catch (error) {
                    console.error(`Error confirming transaction ${signature} on attempt ${i + 1}:`, error);
                }
                // Wait before retrying confirmation
                if (i < maxConfirmRetries - 1) {
                    console.log(`Retrying confirmation for ${signature} in ${confirmRetryInterval / 1000} seconds...`);
                    yield new Promise(resolve => setTimeout(resolve, confirmRetryInterval));
                }
            }
            // If the loop finishes without returning, the transaction was not finalized
            throw new Error(`Transaction ${signature} failed to finalize after ${maxConfirmRetries} retries.`);
        });
    }
}
exports.SolanaService = SolanaService;
//# sourceMappingURL=solanaService.js.map