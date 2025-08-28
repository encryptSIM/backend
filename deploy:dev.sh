gcloud run deploy backend \
  --source . \
  --env-vars-file .env.dev.yaml \
  --region asia-east1 \
  --project encrypsim-dev
