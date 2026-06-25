# Credentials Folder

Credential storage logic currently lives in `src/services/credentials.service.ts` so route and agent flows share one implementation. Keep this folder for future credential-specific adapters or internal API contracts without moving the active service unexpectedly.
