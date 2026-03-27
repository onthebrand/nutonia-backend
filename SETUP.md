# Nutonia Backend - Setup Guide

## 📋 Prerequisites

Before running the backend, you need to set up the following services:

### 1. Supabase (Database + Auth + Storage)

1. Go to [supabase.com](https://supabase.com) and create an account
2. Create a new project
3. Wait for project setup (~2 minutes)
4. Go to Project Settings → API
   - Copy **URL** → This is `SUPABASE_URL`
   - Copy **anon public** key → This is `SUPABASE_ANON_KEY`
   - Copy **service_role** key → This is `SUPABASE_SERVICE_ROLE_KEY`
5. Go to SQL Editor and run the migrations:
   - Open `backend/supabase/migrations/001_initial_schema.sql`
   - Copy **ALL the text inside the file** (not the filename)
   - Paste into Supabase SQL Editor and click Run
   - Open `backend/supabase/migrations/002_helper_functions.sql`
   - Copy **ALL the text inside the file**
   - Paste into Supabase SQL Editor and click Run

### 2. Upstash Redis (Queue + Cache)

1. Go to [upstash.com](https://upstash.com) and create account
2. Create Redis Database
   - Choose "Global" for best latency
   - Enable TLS
3. Copy the **Redis URL** → This is `REDIS_URL`

### 3. Gemini API

1. Go to [ai.google.dev](https://ai.google.dev)
2. Click "Get API Key"
3. Create a new API key
4. Copy the key → This is `GEMINI_API_KEY`

### 4. MercadoPago (Optional for testing)

1. Go to [mercadopago.cl/developers](https://www.mercadopago.cl/developers)
2. Create an account
3. Go to Your integrations → Create application
4. Copy **Access Token** → This is `MERCADOPAGO_ACCESS_TOKEN`
5. Copy **Public Key** → This is `MERCADOPAGO_PUBLIC_KEY`

For testing, you can skip this and use mock values.

### 5. Cloudinary (Optional for MVP)

For MVP, we can skip this or use mock values.

## 🚀 Installation

```bash
cd backend
npm install
```

## ⚙️ Configuration

1. Copy the environment template:
```bash
cp .env.example .env
```

2. Edit `.env` and fill in your credentials:
```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Redis
REDIS_URL=redis://default:your_password@your-redis.upstash.io:6379

# Gemini
GEMINI_API_KEY=your_gemini_api_key

# MercadoPago (optional for testing)
MERCADOPAGO_ACCESS_TOKEN=TEST-your-access-token
MERCADOPAGO_PUBLIC_KEY=TEST-your-public-key

# JWT
JWT_SECRET=your_random_secret_at_least_32_characters_long

# Frontend URL
FRONTEND_URL=http://localhost:5173
```

## 🎯 Run Development Server

```bash
npm run dev
```

The server will start on `http://localhost:3001`

You should see:
```
✓ Redis connected
✓ Content generation worker started
╔═══════════════════════════════════════╗
║   🚀 Nutonia API Server Running      ║
╠═══════════════════════════════════════╣
║  Environment: development             ║
║  Port: 3001                           ║
║  URL: http://localhost:3001           ║
║  Worker: ✓ BullMQ queue active       ║
╚═══════════════════════════════════════╝
```

## ✅ Testing

### Health Check
```bash
curl http://localhost:3001/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-11-26T23:00:00.000Z",
  "environment": "development"
}
```

### Register a User
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "username": "testuser"
  }'
```

### Login
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123"
  }'
```

Save the `session.access_token` from the response.

### Generate Content
```bash
curl -X POST http://localhost:3001/api/generate/content \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "question": "Física Cuántica",
    "profile": {
      "type": "MUSICAL",
      "title": "Musical",
      "model": "gemini-2.5-flash",
      "mediaType": "AUDIO"
    },
    "musicStyle": {
      "name": "Rap",
      "promptInstruction": "rap educativo",
      "sunoTags": "rap, educational, hip hop"
    }
  }'
```

This returns a `jobId`. Poll for status:

```bash
curl http://localhost:3001/api/generate/status/YOUR_JOB_ID \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## 🐛 Troubleshooting

### "API Key not found"
- Make sure `.env` file exists and `GEMINI_API_KEY` is set

### "Cannot connect to Redis"
- Check `REDIS_URL` is correct
- Make sure Upstash database is active

### "User profile not found"
- Run Supabase migrations (see step 1 above)

### TypeScript errors
- Run `npm install` to install all dependencies

## 📝 Next Steps

Once the backend is running:

1. Test all endpoints with Postman or curl
2. Verify content generation works end-to-end
3. Start frontend integration (AuthContext, api client)
4. Test full flow: Register → Login → Generate → View Library

## 🚢 Deploy to Production

See `README.md` for deployment instructions to Railway.app or Cloud Run.
