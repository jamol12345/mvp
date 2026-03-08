---
name: backend-system-design
description: Applies system design, microservices architecture, monolith-to-microservice migration, database optimization and indexing, caching (Redis), message queues, authentication and RBAC, API rate limiting, clean folder structure, SaaS patterns, refactoring, testable code, unit and integration testing, performance profiling, secure backend development, and production deployment. Use when designing or reviewing systems, scaling or migrating services, optimizing databases or caches, implementing auth or rate limits, refactoring, writing tests, profiling performance, or preparing for production.
---

# Backend & System Design

Apply this skill when working on system design, microservices, databases, auth, testing, refactoring, or production deployment.

## Architecture

**System design**
- Identify bounded contexts and service boundaries before coding.
- Prefer explicit contracts (API specs, events) over implicit coupling.
- Design for failure: timeouts, retries, circuit breakers, graceful degradation.

**Microservices**
- One responsibility per service; avoid distributed monoliths (shared DBs, chatty APIs).
- Prefer async communication (events/message queues) for cross-service workflows when appropriate.
- Use API versioning and backward compatibility from day one.

**Monolith-to-microservice migration**
- Extract by capability or domain, not by layer (e.g. “orders service” not “read service”).
- Strangler fig: route new and changed behavior to new services; keep legacy behind facade.
- Migrate data incrementally; avoid big-bang DB splits.

**Clean structure & SaaS**
- Organize by feature/domain (e.g. `users/`, `billing/`, `notifications/`) not by type (`controllers/`, `models/`).
- Multi-tenancy: isolate tenant data (schema, row, or DB per tenant) and enforce in every layer.
- Feature flags and environment-based config for safe rollout and experimentation.

## Data & Caching

**Database optimization**
- Measure before optimizing; use query analysis and slow-query logs.
- Normalize for correctness; denormalize only when justified by read patterns.

**Indexing strategy**
- Index columns used in WHERE, JOIN, ORDER BY; avoid over-indexing writes.
- Consider composite indexes for multi-column filters; order columns by selectivity.
- Monitor index usage and remove unused indexes.

**Caching (Redis and similar)**
- Cache at the right boundary (e.g. per-request, app-level, distributed).
- Define TTLs and invalidation strategy; avoid stale critical data.
- Use patterns: cache-aside, write-through, or write-behind as appropriate.

**Message queues**
- Use for decoupling, async processing, and load leveling; not as a primary DB.
- Design idempotent consumers and dead-letter handling; track processing semantics (at-least-once vs exactly-once).

## Security & Auth

**Authentication**
- Use standard protocols (OAuth2, OIDC, SAML) and proven libraries.
- Store only hashed passwords (e.g. bcrypt/argon2); never log or expose tokens.

**Role-based access control (RBAC)**
- Model roles and permissions explicitly; check permissions at API and data layer.
- Prefer deny-by-default and minimal privilege.

**API rate limiting**
- Apply limits per user/API key/IP as appropriate; return 429 with Retry-After.
- Use token bucket or sliding window; consider distributed state (e.g. Redis) for multi-instance consistency.

**Secure backend**
- Validate and sanitize all inputs; use parameterized queries; avoid building SQL/commands from user input.
- Prefer principle of least privilege for DB and service accounts; secure secrets via env/vault, not code.

## Quality & Refactoring

**Code refactoring**
- Small, behavior-preserving steps; keep tests green after each step.
- Extract services/repositories to clarify boundaries and improve testability.

**Testable code**
- Inject dependencies; avoid global state and static calls in business logic.
- Keep pure business logic in functions/classes that don’t touch I/O.

**Unit and integration testing**
- Unit tests for business rules; integration tests for DB, APIs, and message flows.
- Use test doubles (mocks/stubs) at boundaries; avoid testing implementation details.

**Performance profiling**
- Profile before optimizing; focus on hotspots and critical paths.
- Measure latency percentiles (p95, p99) and throughput; set SLOs and alert on them.

## Production Deployment

- Use environment-based configuration; no secrets in code or repos.
- Health checks (liveness/readiness) and graceful shutdown (drain in-flight requests).
- Logging: structured logs with correlation IDs; avoid logging secrets or PII.
- Observability: metrics, tracing, and alerts on errors, latency, and saturation.
- Prefer immutable deployments and rollback strategy; automate via CI/CD.
