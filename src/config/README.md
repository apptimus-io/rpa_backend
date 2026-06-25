# Backend Environment Contract

Copy `backend/.env.example` to `backend/.env` for local development.
The backend loads this file automatically through `dotenv`.

Production mode validates that these values are present:

- `DATABASE_URL`
- `REDIS_URL`
- `ACCESS_TOKEN_SECRET`
- `REFRESH_TOKEN_SECRET`
- `PASSWORD_RESET_TOKEN_SECRET`
- `CREDENTIAL_ENCRYPTION_KEY`
- `INTERNAL_AGENT_TOKEN`

Optional integration groups:

- Cloudinary: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- Cloudinary upload preset: `CLOUDINARY_UPLOAD_PRESET`
- Gemini fallback: `GEMINI_API_KEY`, `GEMINI_MODEL`
- Email notifications: `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_FROM_ADDRESS`, `MAIL_FROM_NAME`
- SMTP aliases: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `NOTIFICATION_FROM_EMAIL`

Never commit real `.env` files or production secret values.
