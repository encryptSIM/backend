gcloud run deploy backend \
  --source . \
  --env-vars-file .env.staging.yaml \
  --region asia-southeast1 \
  --project encryptsim-staging
