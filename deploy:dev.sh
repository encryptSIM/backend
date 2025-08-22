gcloud run deploy backend \
  --source . \
  --env-vars-file .env.yaml \
  --region asia-east1 \
  --project encrypsim-dev
