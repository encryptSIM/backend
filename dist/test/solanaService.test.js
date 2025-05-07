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
const globals_1 = require("@jest/globals");
const solanaService_1 = require("../src/services/solanaService");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const testPublicKey = 'Fip7DsE6uA9tgQcatYkWQEYfyCmcoYPSrCoTPr2SbE76';
(0, globals_1.describe)('SolanaService.checkSolanaPayment', () => {
    let solanaService;
    solanaService = new solanaService_1.SolanaService();
    (0, globals_1.it)('should return true if the account has more than 10$ worth of SOL', () => __awaiter(void 0, void 0, void 0, function* () {
        const result = yield solanaService.checkSolanaPayment(testPublicKey, '10');
        (0, globals_1.expect)(result.enoughReceived).toBe(true);
    }));
    (0, globals_1.it)('should return false if there is not enough balance', () => __awaiter(void 0, void 0, void 0, function* () {
        const result = yield solanaService.checkSolanaPayment(testPublicKey, '1000000');
        (0, globals_1.expect)(result.enoughReceived).toBe(false);
    }));
    (0, globals_1.it)('should handle errors during API call and throw the error', () => __awaiter(void 0, void 0, void 0, function* () {
        const invalidAddress = 'AbcdEFgHiJkLmNoPqrStUvWxYz1234567890';
        try {
            yield solanaService.checkSolanaPayment(invalidAddress, '0.005');
        }
        catch (error) {
            (0, globals_1.expect)(error.message).toContain("Non-base58 character");
        }
    }));
});
(0, globals_1.describe)('SolanaService.aggregatePaymentToMasterWallet integration test', () => {
    let solanaService;
    solanaService = new solanaService_1.SolanaService();
    (0, globals_1.it)('should aggregate payment to the master wallet and finalize the transaction', () => __awaiter(void 0, void 0, void 0, function* () {
        // --- START CUSTOM PARAMS ---
        // Replace with your actual test data for the aggregatePaymentToMasterWallet function
        // This requires a source wallet with a small amount of SOL to transfer.
        const customAggregateParams = {
            sourcePrivateKey: '[227,99,211,229,217,103,48,198,45,222,160,117,214,71,175,108,144,30,211,25,28,233,97,216,215,111,224,159,83,123,50,194,218,185,177,203,8,10,13,109,33,7,194,19,210,85,101,7,176,51,204,105,65,104,84,129,161,71,213,141,231,7,4,245]',
            amount: 0.001,
        };
        // --- END CUSTOM PARAMS ---
        // Ensure you have set the SOLANA_MASTER_PK environment variable for the SolanaService
        // Ensure the source wallet has enough SOL to cover the amount and transaction fees.
        console.log('Aggregating payment to master wallet with custom params...');
        try {
            const signature = yield solanaService.aggregatePaymentToMasterWallet(customAggregateParams.sourcePrivateKey, customAggregateParams.amount);
            console.log(`Transaction successful with signature: ${signature}`);
            (0, globals_1.expect)(signature).toBeDefined();
            (0, globals_1.expect)(typeof signature).toBe('string');
        }
        catch (error) {
            console.error('Error during aggregatePaymentToMasterWallet test:', error);
            throw error; // Re-throw the error to make the test fail
        }
    }), 60000); // Set Jest timeout for this test case to 60 seconds
});
//# sourceMappingURL=solanaService.test.js.map