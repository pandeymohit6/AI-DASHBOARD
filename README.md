# StayWise AI Rate Optimizer (working MVP)

A multi-tenant hotel revenue-management demo: React + Vite UI, Node.js/Express API, PostgreSQL, and optional local Ollama LLM. It creates asynchronous rate-suggestion jobs, scopes every business query to the authenticated tenant, validates AI output, and falls back to deterministic rules if Ollama is unavailable.

## Architecture
- `apps/api`: Express REST API, JWT demo auth, PostgreSQL queries, background worker.
- `apps/web`: React UI with job polling and loading/error states.
- `db/init.sql`: tenant-safe schema, composite tenant keys/FKs, indexes, seeded demo hotel/data.
- Ollama is local-only by default (`qwen2.5:3b` recommended). No guest names/emails/phone numbers are sent to the model.
- AI output is treated as untrusted, schema-validated, clamped to configured bounds, and never auto-applied to live prices.

## Quick start
Requirements: Docker Desktop (or Docker Engine + Compose), Node.js 20+ if running apps outside Docker.

1. Copy environment file:
   ```bash
   cp .env.example .env
   ```
2. Start database + API + web:
   ```bash
   docker compose up --build
   ```
3. Open `http://localhost:5173`.
4. Sign in with demo credentials:
   - Email: `revenue@demo.staywise.local`
   - Password: `DemoPass!234`
5. Click **Generate suggestions**. The UI polls the job endpoint and shows recommended rates plus rationale.

### Enable local AI (optional)
Ollama must be reachable from the API container. With Ollama installed on the host, set `OLLAMA_BASE_URL=http://host.docker.internal:11434` in `.env`, then:
```bash
ollama pull qwen2.5:3b
```
Restart API: `docker compose up --build api`.
If Ollama is not available, the app still works with a deterministic demand-based baseline and labels the result `rules_fallback`.

## API overview
- `POST /api/auth/login` — issue JWT for demo user
- `GET /api/dashboard` — tenant-scoped hotel, room types and recent demand
- `POST /api/rate-suggestions` — enqueue suggestion job; returns `202 { jobId, status }`
- `GET /api/rate-suggestions/:jobId` — tenant-scoped job status/result
- `GET /api/health` — health check

## Production hardening checklist
This is a runnable MVP, not a drop-in revenue-management engine. Before production:
- Replace demo login/seed JWT secret with your OIDC/SSO provider and secret manager.
- Use a durable queue (SQS/RabbitMQ/BullMQ + Redis) or PostgreSQL `FOR UPDATE SKIP LOCKED` workers with leases, retries and dead-letter handling.
- Add rate limits, audit events, CSRF strategy if cookie auth, secret rotation, TLS, metrics/tracing, alerting, backups and migration tooling.
- Add hotel-specific pricing constraints, taxes, currency, minimum/maximum stay, event calendars, booking windows, cancellation/no-show data and competitor-price provenance.
- Establish model evaluation, shadow mode, human approval, drift monitoring and rollback. Never auto-publish AI-generated rates without approval.
- Use tenant-scoped repository methods/RLS and test cross-tenant access explicitly. PostgreSQL RLS is an additional defense, not a replacement for application authorization.
- Add privacy/DPA review and provider retention controls before using a hosted model. This starter uses local Ollama and sends only aggregate, de-identified room/demand facts.
