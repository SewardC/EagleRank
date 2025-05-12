---
title: Multi-Tenancy & Data Isolation
sidebar_position: 9
---

# Multi-Tenancy & Data Isolation

EagleRank is built from the ground up to be multi-tenant, meaning it can serve multiple distinct applications/users (tenants) from one shared infrastructure, while keeping each tenant's data isolated and allowing customized behavior per tenant.

## Tenant Data Isolation
All data in EagleRank is partitioned by a tenant identifier. We use a unique `tenant_id` string (e.g., "tenantA", "tenantB") throughout:
- Kafka events include `tenant_id`, allowing consumers to segregate processing. Our Flink jobs key by tenant and maintain separate state for each.
- Feature store keys are prefixed with tenant as described (so even if two tenants have a user with the same numeric ID, their data is under different keys).
- Database tables, if any, include `tenant_id` as part of the primary key or use separate schemas. (Isolation can be done via separate schemas or same schema with tenant column plus strict filtering, both approaches are common [frontegg.com](https://frontegg.com/guides/multi-tenant-architecture). We choose the simpler approach of tenant column and application-level enforcement.)
- In memory caches or structures, we always scope by tenant. E.g., the social graph map in Flink is effectively tenant -> (user->followees map).
- The gRPC APIs include `tenant_id` in requests, and the service code ensures that any request is handled in the context of that tenant (loading only that tenant's data).

This design follows a shared application, shared DB with logical partitioning model ([frontegg.com](https://frontegg.com/guides/multi-tenant-architecture)), which is cost-efficient and simpler to operate than fully separate stacks per tenant. Each tenant's data is protected by code: for example, the Ranking service, when fetching features, will only query keys for that tenant. There is no way for a tenant's query to access another tenant's data because the `tenant_id` required for access is part of every query and it's either provided by the client or derived from their auth token.

We considered using separate Kafka topics per tenant (like `tenantA.posts`, `tenantB.posts`). This is possible if tenants have very high volume differences or for easier isolation. Our current approach uses a shared topic with `tenant_id` field and uses Kafka partitioning by tenant (ensuring all messages of a tenant go to certain partitions). This still isolates in processing and simplifies adding a new tenant without creating many new topics. However, if one tenant's traffic grows extremely large, we could split their data to dedicated resources (the design is flexible to evolve into separate topics or even separate clusters if needed).

**Security Isolation:** At the API layer, authentication tokens carry a tenant claim, so a client from tenantA can only request feeds for tenantA's users. The gateway will validate that (e.g., if a tenantA token tries to fetch tenantB data, it rejects). This prevents any cross-tenant data leakage at the API level.

Within the cluster, we don't have hard multi-tenancy security (like each tenant's data on separate machines) as that's not needed unless we have strong isolation requirements. If required (say for compliance), we could actually deploy separate namespaces or even clusters per tenant (with the trade-off of higher cost and complexity). But logically, our multi-tenant in-app isolation suffices for typical SaaS multi-tenancy ([medium.com](https://medium.com/@luishrsoares/data-isolation-approaches-in-multi-tenant-applications-3472ef9a8b93)).

## Configurable Logic Per Tenant
Each tenant might have custom feed logic or business rules. EagleRank accommodates this via configuration and modularity:

- **Ranking model per tenant:** As discussed, we can either train a separate model for each tenant or use one model with tenant features. If one tenant's product is very different (imagine one is a news app, another is an e-commerce feed), we likely deploy distinct models. Our Ranker service can load multiple models and choose based on `tenant_id` (e.g., map tenantA -> model_v1.onnx, tenantB -> model_v2.onnx). The model selection could be configured in a YAML or environment variable. At runtime, the ranking code picks the model accordingly. This means tenantB's ranking can evolve separately from tenantA. For example, tenantB might incorporate a different set of features or have different objective (like optimizing watch time vs clicks).
- **Feature set differences:** Through configuration, we can enable/disable certain features for a tenant. Perhaps tenantB doesn't have the concept of "follow" (maybe it's an algorithmic feed only). In that case, features like `user_follows_author` would be irrelevant. We can either always set them to 0 for that tenant or exclude them. The model for tenantB would be trained without that feature. The serving logic will check tenant and either not fetch some features or ignore them. We maintain separate feature schemas per tenant if needed.
- **Business rules customization:** One tenant might require that certain content always appears at top (e.g., an advertisement or a welcome post). We implement hooks in the Candidate or Ranking stage to allow injecting such items. Concretely, we could have a config like:

```json
"tenantA": { "pin_item_id": "welcome-post-1", "pin_position": 1 }
```

The ranker then, after scoring, will place that item at rank 1 regardless. Or a rule like "tenantB: never show more than 2 posts from the same author in top 10". The ranker can enforce this after initial scoring by demoting some items. These rules are coded with conditions on tenant ID.

- **Different scoring algorithms:** Suppose one tenant doesn't want ML at all but a simple reverse-chronological feed. We can support that: a config flag `use_ml_ranking: false` for that tenant means the Ranker service will, for that tenant, skip model scoring and just sort by timestamp. The gateway or candidate service could even short-circuit (i.e., if chronological, the candidate service can simply return already sorted by time, and ranker just passes it through). This kind of switch is powerful for tenants who are in early stage and not enough data for ML – they can use simpler logic until they gather data. In code, we check config and if `tenant.use_ml = false`, we bypass normal ML and apply alt logic.
- **Tenant-specific model parameters:** Even if using the same model architecture, one tenant might want to bias it differently. For instance, tenantA might want to favor new content more. We could handle this by either training a different model with higher weight on recency or by adding a configurable multiplier in the scoring. For example, after computing score, if tenantA:

```python
final_score = score + recency_bonus(minutes_since_posted * 0.001 * config.tenantA_recency_factor)
```

This is a form of business rule injection. We document these adjustments clearly.

**Configuration Management:** We maintain a config file (YAML/JSON) that maps each tenant. At service startup, we load this config (possibly from a ConfigMap or a parameter store). The config might look like:

```yaml
tenants:
  - id: "tenantA"
    model: "lightgbm_v1.txt"
    use_ml: true
    recency_boost: 1.0
    candidate_sources: ["followed", "trending"]
  - id: "tenantB"
    model: "lightgbm_v2.txt"
    use_ml: true
    recency_boost: 0.5
    candidate_sources: ["recommended"]
  - id: "tenantC"
    model: null
    use_ml: false
    candidate_sources: ["followed"]
```

This says tenantC uses no model (so chronological feed), etc. The services watch this config or at least read it at start. If we needed to change config without redeploying code (like adjusting a parameter), we could update the ConfigMap and trigger pods to reload (some systems allow dynamic reload of config). But redeploying with new config is also fine for now.

**Database Multi-tenancy Patterns:** While we don't have a heavy relational DB usage, note that if we did, we'd likely use the same database with `tenant_id` columns rather than separate DB per tenant (the latter gives complete isolation but is operationally heavy with many tenants [medium.com](https://medium.com/@luishrsoares/data-isolation-approaches-in-multi-tenant-applications-3472ef9a8b93)). We'd enforce row-level isolation either at app or using row-level security features if available.

**Testing Multi-tenancy:** We test with multiple tenants' data to ensure no bleed:
- Simulate events for tenantA and tenantB, ensure feed API for A never returns B's items and vice versa.
- We unit test util functions that build keys or queries to verify tenant id always included.
- We also possibly fuzz test by trying incorrect combinations (like maliciously call feed for tenantB with a token from A, ensure it fails auth as expected).

**Scaling for Multi-tenancy:** The architecture can handle more tenants by essentially partitioning more. If we onboard a new tenant D, we register them in config, possibly create their own Kafka topics (if we go that route) or just start sending events with `tenant_id=D`. The system doesn't need new servers, it will just handle extra load. If volume increases, we scale out horizontally but not per tenant specifically. However, if one tenant becomes extremely large compared to others, we might allocate dedicated resources logically (for instance, a particular Flink job might do more work for that tenant's partition – Flink can handle that if parallelism is high enough, but we could also spin a separate job if needed).

**Data Privacy:** Since tenants share the underlying cluster, we ensure that logs and metrics are also partitioned where needed. E.g., if we ever include any user data in logs, include tenant so that if logs are shared with a tenant for debugging, we can filter. But likely we keep logs internal only.

In cloud multi-tenancy, tenant isolation focuses on context to limit access to resources ([docs.aws.amazon.com](https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/tenant-isolation.html)). We implement that context (`tenant_id`) everywhere in EagleRank. By doing so, we achieve the benefits of multi-tenancy (cost efficiency, centralized management) while ensuring each tenant's data remains exclusive to them and the behavior can be tailored to their needs.

---

For API security, see [API Reference](api.md). For deployment, see [Setup & Deployment](setup.md). 