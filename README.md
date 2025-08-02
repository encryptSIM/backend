# encryptSIM Backend
## Setup Instructions

Follow these steps to configure and deploy the service:

### 1. Download the Firebase Admin Service Account
- Obtain the Firebase Admin service account JSON file from your Firebase project.

### 2. Assign Secret Manager Admin Permissions
- **To the Firebase Admin Service Principal**  
  Grant the "Secret Manager Admin" role to the Firebase Admin service principal.  
  The format of the service principal is:  
  ```
  134243472228-compute@developer.gserviceaccount.com
  ```

- **To the Compute Service Principal**  
  Grant the "Secret Manager Admin" role to the Compute service principal.  
  The format of the service principal is:  
  ```
  firebase-adminsdk-fbsvc@encrypsim-dev.iam.gserviceaccount.com
  ```

### 3. Create a `.env` File
Create a `.env` file in the root directory of your project with the following values:

```env
GOOGLE_APPLICATION_CREDENTIALS=<path-to-service-account>
AIRALO_CLIENT_ID=
AIRALO_CLIENT_SECRET=
AIRALO_CLIENT_URL=
DATABASE_URL=
DVPN_API_KEY=
DVPN_BASE_URL=
GCLOUD_PROJ_ID=
SOLANA_MASTER_PK=
SOLANA_RPC_URL=
FIREBASE_DB_URL=
```

### 4. Create a `.env.yaml` File
Create a `.env.yaml` file with the same environment variables as the `.env` file:

```yaml
GOOGLE_APPLICATION_CREDENTIALS: 
AIRALO_CLIENT_ID: 
AIRALO_CLIENT_SECRET: 
AIRALO_CLIENT_URL: 
DATABASE_URL: 
DVPN_API_KEY: 
DVPN_BASE_URL: 
GCLOUD_PROJ_ID: 
SOLANA_MASTER_PK: 
SOLANA_RPC_URL: 
FIREBASE_DB_URL: 
```

### 5. Add Environment Variables to Google Cloud Secret Manager
Store the environment variables from the `.env` file in Google Cloud Secret Manager.

### 6. Deploy the Service
Deploy the service to Google Cloud Run or your preferred hosting platform.

---

## Notes
- Ensure that all required environment variables are properly configured before deployment.
- For more details on setting up Google Cloud Secret Manager, refer to the [official documentation](https://cloud.google.com/secret-manager/docs).

## Development

The server should start automatically when launching a workspace. To start the server manually, use the following command:

```sh
npm run dev
```

---

