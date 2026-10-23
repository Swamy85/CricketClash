# CricketClash

## Local development

1. In `backend`, copy `.env.example` to `.env` and set `MONGODB_URI`,
   `JWT_SECRET`, and the Brevo settings below.
2. Start MongoDB, then run `npm install` and `npm run dev` from `backend`.
3. In a second terminal, run `npm install` and `npm run dev` from `frontend`.
   Vite forwards `/api` requests to `http://localhost:5000` by default.
4. If the backend runs on another URL, set `VITE_API_PROXY_TARGET` in
   `frontend/.env` and restart Vite. For a production frontend, set
   `VITE_API_URL` to the API origin (or route `/api` through the same origin).

The backend exposes `GET /api/health` to report whether MongoDB is connected.
When the database is unavailable, the backend logs the MongoDB connection
error and does not start listening.

## Email verification

Add these values to `backend/.env`:

```dotenv
BREVO_API_KEY=your_brevo_api_key
BREVO_SENDER_EMAIL=your_verified_sender@example.com
BREVO_SENDER_NAME=CricketClash
```

Use the Brevo **API key** (from SMTP & API → API Keys), not the SMTP key.
The sender address must be an address/domain verified in your Brevo account;
do not use a `@smtp-brevo.com` address. Never put real credentials in
`.env.example` or commit them. If a real key was exposed, revoke it in Brevo
and generate a replacement before using it again.

Registration emails contain a
six-digit code that expires after 10 minutes; requests to resend are limited
to one per minute. The account is created and signed in only after the code is
verified. Each account receives a unique `CC-` user ID.
