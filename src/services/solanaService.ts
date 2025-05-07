import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import axios from 'axios';

export class SolanaService {
  private connection: Connection;
  private masterPublicKey: PublicKey;

  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL;

    if (!rpcUrl) {
      throw new Error('SOLANA_RPC_URL environment variable is not set.');
    }

    this.connection = new Connection(rpcUrl);
    this.masterPublicKey = new PublicKey(process.env.SOLANA_MASTER_PK || "");
  }

  public async createNewSolanaWallet(): Promise<{ publicKey: string, privateKey: string }> {
    const newWallet = Keypair.generate();
    const publicKey = newWallet.publicKey.toBase58();
    const privateKey = JSON.stringify(Array.from(newWallet.secretKey));
    return { publicKey, privateKey };
  }

  public async checkSolanaPayment(address: string, expectedAmountUSD: string): Promise<any> {

    // Convert expected amount from string to number
    const expectedAmountUSDNumber = parseFloat(expectedAmountUSD);

    const publicKey = new PublicKey(address);
    const balance = await this.connection.getBalance(publicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;

    // Fetch SOL price from Coingecko
    const solPrice = await this.fetchSolPrice();
    console.log("solPrice: ", solPrice);
    if (!solPrice) {
      throw new Error("Could not fetch SOL price");
    }

    // Convert expected amount in USD to SOL
    const expectedAmountSOL = expectedAmountUSDNumber / solPrice;

    const enoughReceived = solBalance >= expectedAmountSOL;

    return { enoughReceived, solBalance };
  }

  private async fetchSolPrice(): Promise<number | null> {
    try {
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      console.log("fetch: ", response);
      return response.data.solana.usd;
    } catch (error) {
      console.error('Error fetching SOL price from Coingecko:', error);
      return null;
    }
  }

  public async aggregatePaymentToMasterWallet(sourcePrivateKey: string, amount: number): Promise<string> {
    const sourceWallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(sourcePrivateKey)));
    const lamports = amount * LAMPORTS_PER_SOL;

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sourceWallet.publicKey,
        toPubkey: this.masterPublicKey,
        lamports: lamports,
      })
    );

    const maxSendRetries = 5;
    const sendRetryInterval = 2000; // 2 seconds
    const maxConfirmRetries = 5;
    const confirmRetryInterval = 2000; // 2 seconds

    let signature: string | undefined;
    let sendError: any;

    // Retry sending the transaction
    for (let i = 0; i < maxSendRetries; i++) {
      try {
        console.log(`Attempt ${i + 1} to send transaction...`);
        signature = await this.connection.sendTransaction(transaction, [sourceWallet]);
        console.log(`Transaction sent with signature: ${signature}`);
        sendError = undefined; // Clear any previous send error
        break; // Exit send retry loop on success
      } catch (error) {
        sendError = error;
        console.error(`Error sending transaction on attempt ${i + 1}:`, error);
        if (i < maxSendRetries - 1) {
          console.log(`Retrying send in ${sendRetryInterval / 1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, sendRetryInterval));
        }
      }
    }

    if (sendError || !signature) {
      throw new Error(`Failed to send transaction after ${maxSendRetries} retries: ${sendError?.message || 'Unknown error'}`);
    }

    // Retry confirming the transaction
    for (let i = 0; i < maxConfirmRetries; i++) {
      try {
        console.log(`Attempt ${i + 1} to confirm transaction ${signature}...`);
        const status = await this.connection.confirmTransaction(signature, 'finalized');

        // Check if the transaction is finalized
        if (status.value.err === null) {
          console.log(`Transaction ${signature} finalized.`);
          return signature; // Return signature on successful finalization
        } else {
          console.warn(`Transaction ${signature} failed to finalize on attempt ${i + 1}:`, status.value.err);
        }
      } catch (error) {
        console.error(`Error confirming transaction ${signature} on attempt ${i + 1}:`, error);
      }

      // Wait before retrying confirmation
      if (i < maxConfirmRetries - 1) {
        console.log(`Retrying confirmation for ${signature} in ${confirmRetryInterval / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, confirmRetryInterval));
      }
    }

    // If the loop finishes without returning, the transaction was not finalized
    throw new Error(`Transaction ${signature} failed to finalize after ${maxConfirmRetries} retries.`);
  }
}