---
title: API Gateway (gRPC & REST)
sidebar_position: 10
---

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

**Multi-Tenant Routing:** The gateway inspects the tenant_id in requests (or deduces it from the auth token domain). This tenant ID is then attached to all subsequent calls – e.g., when calling candidate service, it includes tenant context, and same for ranker. This way, the downstream services know which tenant's data to operate on. If we had completely separate deployments per tenant, the gateway could also route to different endpoints, but our design keeps one deployment handling all tenants, just partitioned by IDs.

**Docker & Deployment:** The gateway is containerized and runs on AWS EKS behind an external facing load balancer. If using AWS ALB, we might use the ALB's HTTP listener for REST and forward HTTP/2 to the gRPC service (ALB supports gRPC now). If using Envoy, Envoy would be the entry point. For simplicity, we might expose two ports: one for REST (HTTP/1.1 + JSON) and one for gRPC (HTTP/2). Clients like mobile could directly use gRPC if they support HTTP/2 (most modern mobile can), or fall back to REST.

We set up auto-scaling here too if needed (though gateway is lightweight CPU-wise). Also, we configure health checks (K8s liveness probe calls a /healthz that our server exposes, simply returning ok if it's up; also a readiness probe to ensure it only gets traffic when ready).

**Logging and Tracing:** The gateway attaches a request ID or trace ID for each incoming request (could use OpenTelemetry to start a trace span) so we can follow the call through to candidate and ranker. 