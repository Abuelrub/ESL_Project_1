# ESL Vocabulary App

AI-powered vocabulary practice for ESL students. Next.js + Supabase + Anthropic API.

## Run locally

1. Install Node.js 20+ from https://nodejs.org
2. In this folder run: `npm install`
3. Copy `.env.local.example` to `.env.local` and fill in your Supabase URL,
   anon key, service_role key, and Anthropic API key.
4. Run: `npm run dev` and open http://localhost:3000

## Logins

Usernames map to internal emails: username `admin` = `admin@esl.local`.
Log in with the username only (e.g. `admin`, `M00657654`) plus password.

## Deploy to Vercel

1. Push this folder to a GitHub repository.
2. In vercel.com: New Project > import the repo.
3. Add the four environment variables from `.env.local` in Vercel settings.
4. Deploy.
