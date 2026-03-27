# Nutonia Backend API

Backend API for Nutonia - AI-powered educational content generation platform.

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Supabase account
- Upstash Redis account
- Gemini API key
- MercadoPago account (for payments)

### Installation

```bash
# Install dependencies
cd backend
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
```

### Environment Setup

1. **Supabase**: Create a project at [supabase.com](https://supabase.com)
   - Copy your project URL and keys to `.env`
   - Run migrations in Supabase SQL editor

2. **Redis**: Create database at [upstash.com](https://upstash.com)
   - Copy Redis URL to `.env`

3. **Gemini API**: Get key from [ai.google.dev](https://ai.google.dev)

4. **MercadoPago**: Create app at [mercadopago.cl](https://www.mercadopago.cl/developers)

### Running Migrations

```bash
# Copy SQL from backend/supabase/migrations/*.sql
# Paste into Supabase SQL Editor and run
```

### Development

```bash
npm run dev
```

Server runs on `http://localhost:3001`

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration (env, supabase, redis, etc.)
│   ├── middleware/      # Auth, rate limiting, error handling
│   ├── routes/          # API route definitions
│   ├── controllers/     # Request handlers
│   ├── services/        # Business logic
│   └── server.ts        # Express app entry point
├── supabase/
│   └── migrations/      # SQL migrations
└── package.json
```

## 🔌 API Endpoints

### Authentication
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Content Generation
- `POST /api/generate/content` - Queue generation
- `GET /api/generate/status/:jobId` - Poll status

### Library
- `GET /api/library` - Get user's content
- `POST /api/library` - Save content
- `DELETE /api/library/:id` - Delete content

### Viralization
- `POST /api/share/track` - Track share event
- `GET /api/share/stats/:contentId` - Share stats
- `POST /api/share/referral/generate` - Get referral code
- `POST /api/share/referral/redeem` - Redeem code
- `GET /api/share/referral/stats` - Referral stats

### Credits
- `GET /api/credits/balance` - Get balance
- `POST /api/credits/purchase` - Buy credits
- `GET /api/credits/history` - Transaction history
- `POST /api/credits/mercadopago/webhook` - Payment webhook

### Users
- `GET /api/users/:username` - Public profile

## 🔒 Authentication

All protected routes require `Authorization: Bearer <token>` header with Supabase JWT.

## 🧪 Testing

```bash
npm test
```

## 🚢 Deployment

### Railway.app (Recommended for MVP)

1. Connect GitHub repo
2. Add environment variables
3. Deploy automatically

### Manual Deploy

```bash
npm run build
npm start
```

## 📊 Database Schema

See `supabase/migrations/001_initial_schema.sql` for complete schema.

Key tables:
- `users` - User accounts
- `content` - Generated content
- `credit_transactions` - Credits history
- `share_events` - Viralization tracking
- `collections` - Courses

## ⚡ Performance

- Rate limiting: 100 req/min per IP
- Free tier: 5 generations/day
- Credits cache in Redis
- DB indexes on high-traffic columns

## 📝 License

UNLICENSED - Private project
