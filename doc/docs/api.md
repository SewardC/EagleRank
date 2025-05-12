---
title: API Reference
sidebar_position: 5
---

# API Reference

EagleRank exposes high-performance APIs for real-time ranking and integration with external systems. This section provides a detailed, verbatim reference for all API contracts, schemas, and authentication mechanisms, as implemented in the system.

## API Gateway (gRPC & REST)

**Purpose:** The API Gateway provides a unified interface to clients (mobile apps, web apps, and the EagleRank Web UI) and orchestrates the calls to backend services. It exposes endpoints for retrieving feeds and possibly for logging user interactions (to feed back into the system). It also handles cross-cutting concerns like auth, rate limiting, and request routing to the correct tenant context.

**Technology:** We implement the gateway using gRPC with a gateway proxy for REST. There are a couple of approaches:
- Use Envoy Proxy with gRPC-Web support to allow browser clients to communicate via gRPC-Web, and Envoy forwards to our gRPC service(s) ([adjoe.io](https://adjoe.io/company/engineer-blog/working-with-grpc-web/)).
- Or use the grpc-gateway library in Go which generates RESTful endpoints from the protobuf definitions.

We choose to write a small Go gRPC server (since Go has great support for gRPC and high performance networking). We use the protobuf definitions for FeedService and implement them. For REST support (for tenant apps that might want to call over HTTP), we can either deploy Envoy or simply use grpc-gateway generator so that the Go server also listens on an HTTP port for JSON requests.

**Functionality:**
- The gateway receives a FeedRequest (which includes the requesting user's ID and tenant). It first authenticates the request (see Security section), ensuring the user is authorized to get that feed.
- It then calls the Candidate Generation service and Ranking service. We have a choice: call them separately (the gateway acts as an orchestrator), or have one service call the other. For clarity in this design, the gateway itself will do:
  1. `candList = candidateService.GetCandidates(user)` (this returns a list of item IDs possibly with basic info).
  2. `rankedItems = rankerService.GetRankedList(user, candList)` (we might have an RPC that accepts the candidates so the ranker can fetch features and score).
- Alternatively, we could combine these in one service call if the separation isn't needed externally. For now, the gateway does two internal gRPC calls.
- Once the ranked items are returned, the gateway formats the output (as FeedResponse with item metadata). If using grpc-gateway for REST, it automatically converts the protobuf to JSON.

**gRPC-Web for Web UI:** The EagleRank Web UI uses gRPC-Web to call the gateway. gRPC-Web is a JavaScript library that wraps gRPC calls to work over HTTP/1.1 from browsers, typically needing a proxy like Envoy to translate to real gRPC ([adjoe.io](https://adjoe.io/company/engineer-blog/working-with-grpc-web/)). In our deployment, we include an Envoy sidecar or a separate Envoy deployment that the Web UI calls. The Envoy is configured with the gRPC-Web filter to convert browser requests to HTTP/2 gRPC to our gateway service ([adjoe.io](https://adjoe.io/company/engineer-blog/working-with-grpc-web/)). This setup eliminates the need for a dedicated REST API for the web client. (Alternatively, we could just use the grpc-gateway JSON for the web UI too. Both options are viable; we document gRPC-Web to demonstrate modern usage).

**Rate Limiting:** We implement simple rate limiting in the gateway, e.g., using a token bucket per API key or user IP. In Go, we can use a middleware that tracks requests in-memory or use an external service like Envoy's rate limiting service. Since traffic is not enormous initially, an in-process limiter suffices (like a map of counters with expiration). Each tenant could have configured QPS limits.

**Multi-Tenant Routing:** The gateway inspects the `tenant_id` in requests (or deduces it from the auth token domain). This tenant ID is then attached to all subsequent calls – e.g., when calling candidate service, it includes tenant context, and same for ranker. This way, the downstream services know which tenant's data to operate on. If we had completely separate deployments per tenant, the gateway could also route to different endpoints, but our design keeps one deployment handling all tenants, just partitioned by IDs.

---

## 3. API and Data Contracts
A clear definition of APIs and data schemas ensures that all components (and tenants) integrate correctly. We describe here the gRPC API contracts, Kafka message schemas, and the feature data formats.

### 3.1 gRPC API Definitions
EagleRank's internal APIs are defined with Protocol Buffers (.proto files) for strong typing and easy generation of client/server code. The external facing API (via the Gateway) includes:

#### FeedService API
- `GetFeed(FeedRequest) -> FeedResponse` — retrieves a ranked feed for a user.
- `ListTenants()` (admin) — perhaps to list available tenants or system status (for management).
- We could also have methods like `LogEvent(EventRequest)` to allow clients to send interaction events (if they send directly rather than through Kafka – but in our design clients don't talk directly to Kafka, so this might be a convenience in some cases).

**Example FeedRequest and FeedResponse in proto (for external API):**

```protobuf
message FeedRequest {
  string tenant_id;
  string user_id;
  uint32 page_size = 20; // number of items requested
}
message FeedItem {
  string id;
  string author_id;
  string content_text;
  double score;
  int64 timestamp;
}
message FeedResponse {
  repeated FeedItem items;
  int64 generated_at; // server timestamp
}
```

Here we include `content_text` for demo purposes (in real use, the tenant's system would supply content separately, but we include it to make the feed self-contained for now).

**For the internal gRPC between services:**

**CandidateService:**
```protobuf
service CandidateService {
  rpc GetCandidates(CandidateRequest) returns (CandidateResponse);
}
message CandidateRequest {
  string tenant_id;
  string user_id;
  uint32 max_results;
}
message CandidateResponse {
  repeated FeedItem candidates;
}
```
The FeedItem here might only include ID, author, timestamp (no score yet).

**RankerService:**
```protobuf
service RankerService {
  rpc RankFeed(RankFeedRequest) returns (FeedResponse);
}
message RankFeedRequest {
  string tenant_id;
  string user_id;
  repeated FeedItem candidates;
}
```
It returns a FeedResponse which is the ranked items (with scores).

Using protobuf ensures our data contracts are language-agnostic and versioned. For example, if we add a new field to FeedItem (say, category), older clients simply ignore it if unknown.

We also define message types for the events (though events are carried by Kafka, defining them in proto or Avro serves a similar documentation purpose):

### 3.2 Kafka Message Schemas
All Kafka messages adhere to a defined schema:

**PostCreated Event (when a user creates new content):**
```json
{
  "tenant_id": "tenantA",
  "post_id": "xyz123",
  "author_id": "user45",
  "timestamp": 1694040000000,
  "content": {
    "text": "Hello world!",
    "media_url": null
  }
}
```
This could be Avro-serialized with a schema ID. The content field is optional metadata (the ranking system might not need full content, but we capture it for completeness).

**FollowEvent:**
```json
{
  "tenant_id": "tenantA",
  "follower_id": "user45",
  "followee_id": "user67",
  "action": "follow", // or "unfollow"
  "timestamp": 1694030000000
}
```
This instructs the graph updater.

**EngagementEvent (like a user liking or clicking something):**
```json
{
  "tenant_id": "tenantA",
  "user_id": "user45",
  "item_id": "xyz123",
  "event_type": "like", // could be "click", "share", etc.
  "timestamp": 1694050000000
}
```
This feeds into feature updates and model training data.

All messages include `tenant_id` explicitly as part of the schema for partitioning and isolation. If using Avro, each schema is registered in Schema Registry under a subject like `tenantA-feed-posts` or a generic `feed-posts` (with tenant as a field).

**Schema Evolution:** If we need to evolve event schemas (add fields such as a new engagement type), Avro and Protobuf handle that via backward compatibility. We enforce that any consumer (like Flink) ignores unknown fields to remain compatible.

---

### 3.3 Feature Store Data Format
The feature store holds data often in simple key-value or key-hash forms:
- For Redis, a common pattern is:
  - Key: `tenant:{tenant_id}:user:{user_id}:features` with a hash of feature name to value.
  - Key: `tenant:{tenant_id}:item:{item_id}:features` similarly for items.
  - Some features might also be stored as sorted sets or counters for quick aggregation (e.g., `popularity_rank` might be a sorted set of item IDs by score).
- If using a relational store for features (not in this design, but possible), we'd have tables like `user_features(tenant_id, user_id, feature_name, value)` (wide or tall schema).

**Example:** For user45 in tenantA, we might have:
```json
// Redis hash at key "tenant:tenantA:user:user45:features"
{
  "avg_session_time": 300.5,
  "likes_last_7d": 12,
  "follower_count": 50,
  "following_count": 55,
  "interest_vector": "[0.12, 0.8, ...]" // maybe stored as JSON string
}
```
And for item xyz123:
```json
{
  "age_hours": 5,
  "base_quality_score": 0.7,
  "like_count": 10,
  "author_id": "user67"
}
```
When the Ranker is assembling features, it will fetch both user45's hash and item xyz123's hash and then combine relevant fields. Some features like `author_id` might link item to author's features, which the ranker can also fetch (author is another user).

For efficient model input, we usually convert these feature values into a fixed-order vector. The ordering and selection is determined by how the model was trained (feature engineering step). For example, the model might expect input features `[user_click_rate, user_follower_count, item_age, item_popularity, user_follows_author]`. The ranker code will map values from feature store into this array in the correct order. To avoid mis-ordering, we maintain a feature metadata file or enum that lists each feature name and its index in the model input. This acts as the contract between training and serving. (If using ONNX, the model may have named inputs, but typically for tree models we just feed a single array; we document the order carefully in the code and training pipeline.)

We also consider data types: features can be numeric (int, float), categorical (which might be represented as an ID that the model will interpret via one-hot or embedding). For instance, `tenant_id` could be treated as a categorical feature with an embedding vector in a neural model, but for LightGBM we might just give it as an integer and rely on separate model instances or one-hot encoding if needed. Another example: content category might be an enum turned into multiple binary features.

**Contract:** We document each feature:
- Name, description, type, range.

See the [Feature Store Data Format & Catalog](feature-catalog.md) for the full feature catalog table and detailed field documentation.

By rigorously defining API contracts and schemas as above, we ensure each part of EagleRank (as well as external tenant integrations) operate on a consistent understanding of the data structures, reducing integration bugs and easing future extensions.

---

## Authentication and Security

### API Authentication and Authorization
Authentication: We secure the external API Gateway using JWT (JSON Web Tokens) issued by an identity provider. Each tenant's application (e.g., mobile app or server) must authenticate users, and then request a token to call EagleRank. We either have:
- Tenants obtain a service-to-service token if the feed is requested from a backend, or
- End-users have JWTs from the tenant's auth system which the EagleRank gateway can validate (with tenant's public keys or via an introspection endpoint).

For simplicity, we can issue tokens per tenant that include the `tenant_id` and possibly a `user_id` claim. The EagleRank gateway uses a JWT middleware (e.g., jwt-go library or in Rust jsonwebtoken) to validate the signature and expiry. We share a secret or RSA public key per tenant for validation. This ensures that callers are genuine.

We also allow certain admin tokens for internal use (e.g., the Web UI might use an admin JWT that grants broader access to debugging endpoints).

**gRPC Metadata:** In gRPC, the JWT can be passed in the metadata (like `authorization: Bearer <token>`). We intercept it in the gateway.

**Authorization:** Once authenticated, we enforce:
- A user or client from tenant X can only access data for tenant X. This is achieved by including `tenant_id` in JWT and cross-checking with any request parameter for tenant. If there's a mismatch, we reject. If a client tries to omit tenant to get all data, we require it, so no accidental leak.
- Additionally, within a tenant, certain roles might have restricted actions:
  - For example, normal end-users can only call GetFeed for themselves (their `user_id` matches the token's `user_id` claim).
  - An admin user of tenant could fetch feeds for any user in their tenant (for customer support or testing).
  - The EagleRank Web UI (platform admin) can specify any tenant and user to fetch a feed (that's only accessible to our internal team).

We implement these via claims in the JWT such as `role:user` or `role:tenant_admin`. The gateway checks:
- If role is user, ensure `request.user_id == token.user_id`.
- If role is tenant_admin, ensure `request.tenant_id == token.tenant_id` but can allow any user_id.
- If role is platform_admin, allow any tenant (for our internal usage only).

This effectively is role-based access control (RBAC) where roles are embedded in the token. The gateway acts as the policy enforcer. This stops, for example, a malicious user from altering the request `user_id` to someone else – the token claim mismatch will cause an error.

**Token generation and management:** We assume tenants handle logging their users in and giving them tokens. For service-to-service (like a backend cron job calling EagleRank), we could issue a long-lived token or use client certificate authentication. Possibly, each tenant has an API key or client certificate that the gateway accepts (we might support both JWT and API key header for server contexts). But JWT is more flexible and standard ([apidog.com](https://apidog.com/blog/grpc-authentication-best-practices/)).

We ensure tokens use strong signing (RSA or HS256 with strong secret) and have expiration times (maybe 1 hour for user tokens). Our gateway caches or verifies quickly (could use JWKS endpoints for tenant's auth if integrated). This prevents unauthorized access due to token forgery.

**Encryption:** All external communication with EagleRank is over HTTPS/TLS (for REST) or TLS for gRPC (HTTP/2). If using ALB or API Gateway, TLS termination is at the LB. If directly exposing via NLB, we can have services themselves do TLS (maybe using cert-manager in K8s to get Let's Encrypt certs for our domain). In any case, tokens and data are protected in transit by TLS. Internally, service-to-service in cluster can be plain text (within VPC), but for zero trust approach we could also encrypt internal traffic (perhaps using mTLS via a service mesh, but that's heavy for one dev; we rely on network isolation instead for internals).

---

### Rate Limiting and Abuse Prevention
To prevent misuse or overloading by a single client, we implement rate limiting at the Gateway:
- We assign each caller an identifier for rate limiting (for user-driven calls, could use `user_id` or IP; for tenant backend calls, use an API key or client ID).
- We define limits such as "no more than 10 requests per second per user" or "no more than 1000 requests per minute per tenant". These numbers depend on expected usage patterns.
- Implementation using a token bucket algorithm or a library: In Go, we might use `golang.org/x/time/rate` or use a Redis-based counter for distributed rate limiting if we have multiple gateway instances (to ensure the limit is global across instances).
- Simpler: because each user typically wouldn't refresh feed more than a couple times per minute, we can enforce something like 30 rpm per user. If exceeded, we return HTTP 429 Too Many Requests (or gRPC code ResourceExhausted).
- For per-tenant, if one tenant's traffic volume threatens to starve others or blow our budget, we cap it. E.g., 100 req/s for tenantA overall. This prevents a misbehaving integration from affecting overall service.

Rate limiting also helps mitigate malicious scraping or denial-of-service attempts. It's not full DDoS protection (we'd rely on AWS Shield/Firewall or Cloudflare if needed), but it handles moderate abuse.

Spike prevention: We can combine rate limiting with circuit breakers. If a downstream (like Redis or model) is under heavy load and latencies rise, the gateway might temporarily reject some requests quickly to avoid pile-ups (fail fast).

---

For more, see [gRPC Authentication Best Practices](https://apidog.com/blog/grpc-authentication-best-practices/). 