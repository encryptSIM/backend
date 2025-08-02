import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { Logging } from '@google-cloud/logging';
import admin from "firebase-admin";

const client = new SecretManagerServiceClient();

export async function accessSecretJSON(secretName: string, versionId = 'latest'): Promise<any> {
  const [version] = await client.accessSecretVersion({
    name: `projects/${process.env.GCLOUD_PROJ_ID}/secrets/${secretName}/versions/${versionId}`,
  });

  const payload = version.payload?.data?.toString();
  if (!payload) {
    throw new Error(`Secret ${secretName} version ${versionId} has no data.`);
  }
  return JSON.parse(payload)
}

export async function accessSecretValue(secretName: string, versionId = 'latest'): Promise<string> {
  const [version] = await client.accessSecretVersion({
    name: `projects/${process.env.GCLOUD_PROJ_ID}/secrets/${secretName}/versions/${versionId}`,
  });

  const payload = version.payload?.data?.toString();
  if (!payload) {
    throw new Error(`Secret ${secretName} version ${versionId} has no data.`);
  }
  return payload
}

export async function initializeFirebase(): Promise<admin.database.Database> {
  // Initialize Firebase Admin SDK
  const firebaseDatabaseUrl: string = process.env.FIREBASE_DB_URL
  if (admin.apps.length === 0) {
    // Fetch the service account using the async function
    const serviceAccount = await accessSecretJSON('firebase-admin'); // Use the correct secret name

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount), // Use the fetched service account
        databaseURL: firebaseDatabaseUrl,
      });
    } else {
      throw new Error('Failed to authenticate Firebase');
    }
  }
  return admin.database(); // Assign the initialized database to the global variable
}

export class DBHandler {
  private db: admin.database.Database;

  constructor(db: admin.database.Database) {
    this.db = db;
  }

  public async getPaymentProfile(ppPublicKey: string): Promise<any> {
    const ppSnapshot = await this.db.ref(`/payment_profiles/${ppPublicKey}`).once('value');
    const pp = ppSnapshot.val()

    return pp
  }

  public async updatePPOrder(ppPublicKey: string, order_id: string): Promise<void> {
    const ppRef = this.db.ref(`/payment_profiles/${ppPublicKey}`);
    const ppSnapshot = await ppRef.once('value');
    const pp = ppSnapshot.val();

    let orderIds: string[] = [];

    if (pp && pp.orderIds) {
      orderIds = pp.orderIds;
    }

    orderIds.push(order_id);

    await ppRef.update({ orderIds });
  }
}

export class GCloudLogger {
  private logging: Logging

  constructor() {
    const GCLOUD_PROJ_ID = process.env.GCLOUD_PROJ_ID;
    this.logging = new Logging({
      projectId: GCLOUD_PROJ_ID
    });
  }

  public logINFO(message: string) {
    const log = this.logging.log('esim-log');
    const metadata = {
      resource: {
        type: 'global'
      },
      severity: 'INFO'
    };
    const entry = log.entry(metadata, message);

    log.write(entry);
  }

  public logDEBUG(message: string) {
    const log = this.logging.log('esim-log');
    const metadata = {
      resource: {
        type: 'global'
      },
      severity: 'DEBUG'
    };
    const entry = log.entry(metadata, message);

    log.write(entry);
  }

  public logERROR(message: string) {
    const log = this.logging.log('esim-log');
    const metadata = {
      resource: {
        type: 'global'
      },
      severity: 'ERROR'
    };
    const entry = log.entry(metadata, message);

    log.write(entry);
  }
}
