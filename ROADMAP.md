# Nutonia - Roadmap de Implementación

Este documento rastrea el progreso de la implementación del backend de Nutonia.

## ✅ Completado

### Fase 1 - Semana 1-2: Setup y Fundamentos

- [x] Crear estructura de proyecto backend
- [x] Configurar package.json y TypeScript
- [x] Setup Supabase client y variables de entorno
- [x] Crear middleware de autenticación
- [x] Crear migraciones SQL iniciales
  - [x] Tabla users
  - [x] Tabla content  
  - [x] Tabla credit_transactions
  - [x] Tabla share_events
  - [x] Tabla user_styles
  - [x] Tablas: collections, subscriptions, social_interactions
  - [x] Funciones SQL helper
- [x] Implementar endpoints de auth
  - [x] POST /api/auth/register
  - [x] POST /api/auth/login
  - [x] GET /api/auth/me
- [x] Setup Redis (Upstash) config
- [x] Middleware de rate limiting
- [x] Middleware de credits check
- [x] Routes: auth, generate, library, share, credits, users
- [x] Controllers: auth, library, users, share, credits
- [x] README.md con documentación

### Endpoints Implementados

**Auth** ✅
- POST /api/auth/register
- POST /api/auth/login  
- GET /api/auth/me

**Library** ✅
- GET /api/library
- POST /api/library
- DELETE /api/library/:id

**Share/Viralization** ✅
- POST /api/share/track
- GET /api/share/stats/:contentId
- POST /api/share/referral/generate
- POST /api/share/referral/redeem
- GET /api/share/referral/stats

**Credits** ✅
- GET /api/credits/balance
- POST /api/credits/purchase
- GET /api/credits/history
- POST /api/credits/mercadopago/webhook

**Users** ✅
- GET /api/users/:username

**Generate** 🔶 Parcialmente
- POST /api/generate/content (solo queuing, sin worker)
- GET /api/generate/status/:jobId

## 🚧 En Progreso / Pendiente

### Fase 1 - Semana 3: Generación de Contenido

- [ ] Migrar geminiService.ts completo al backend
- [ ] Crear queue worker con BullMQ
- [ ] Integrar Supabase Storage para guardar archivos
- [ ] Sistema de créditos: deducción al generar

### Fase 1 - Semana 4: MercadoPago y Deploy

- [ ] Completar integración real de MercadoPago SDK
- [ ] Webhook verification y processing
- [ ] Deploy a Railway.app staging
- [ ] Tests de endpoints críticos

### Frontend (Paralelo)

- [ ] Instalar @supabase/supabase-js + axios
- [ ] Crear AuthContext.tsx
- [ ] Crear api/client.ts
- [ ] Componentes de auth (Login, Register)
- [ ] ShareModal.tsx
- [ ] CreditsPurchaseModal.tsx
- [ ] Modificar Generator.tsx (polling)
- [ ] Modificar Library.tsx (API)
- [ ] CreditBalance component en header

## 📋 Próximos Pasos Inmediatos

1. **Migrar geminiService.ts** del frontend al backend
2. **Implementar BullMQ worker** para generación asíncrona
3. **Configurar Supabase Storage** para archivos
4. **Completar MercadoPago** integration real
5. **Crear .env** local con credenciales
6. **Probar endpoints** con Postman/Thunder Client

## 🎯 Estado Actual

**Backend Core**: ~85% completo
- ✅ Auth system
- ✅ Database schema
- ✅ Middleware stack
- ✅ Basic CRUD endpoints
- ✅ Viralization system
- 🔶 Generation system (needs worker)
- 🔶 MercadoPago (needs SDK integration)

**Listo para**:
- Testing local de auth
- Testing de share tracking
- Migración de geminiService

**Bloqueado por**:
- Supabase credentials (necesita crear proyecto)
- Redis URL (necesita crear Upstash DB)
- MercadoPago credentials

## 🔑 Credenciales Necesarias

Para ejecutar el backend localmente, necesitas:

1. **Supabase**:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY  
   - SUPABASE_SERVICE_ROLE_KEY

2. **Upstash Redis**:
   - REDIS_URL

3. **Gemini API**:
   - GEMINI_API_KEY

4. **MercadoPago**:
   - MERCADOPAGO_ACCESS_TOKEN
   - MERCADOPAGO_PUBLIC_KEY

5. **Cloudinary** (opcional para MVP):
   - CLOUDINARY_CLOUD_NAME
   - CLOUDINARY_API_KEY
   - CLOUDINARY_API_SECRET

## 📝 Notas

- El backend está estructurado y listo para migrar
- Todos los middlewares están implementados
- Schema SQL completo con RLS policies
- Falta implementar worker de generación (semana 3)
- MercadoPago está parcialmente implementado (falta SDK real)
