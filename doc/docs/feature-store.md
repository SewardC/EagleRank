---
title: Feature Store
sidebar_position: 3
---

# Feature Store

## Technology
The feature store consists of two parts: offline storage (for batch-computed features) and online storage (for serving features at low latency). For offline, we use Amazon S3 and possibly a data warehouse (like Snowflake or Redshift) to store large historical feature data and training datasets. For the online component, we use Redis (ElastiCache) as a fast in-memory database, augmented by an optional persistent store (like DynamoDB or Cassandra) if needed for larger feature sets.

## Data Model
Features are stored with a composite key of (tenant, entity_type, entity_id). For example, user features for user 123 of tenant A might be stored under key `A:user:123` in Redis, which maps to a hash of feature name → value. Item features for post XYZ would be `A:post:XYZ`. We also store cross-entity features (like user-item interaction features) when applicable, though many of those are computed on the fly or via embeddings.

## Batch Features
We run periodic batch jobs (using Python scripts or AWS Glue/Athena queries) to compute heavy features that don't need real-time updates. For example, a user's long-term engagement score, or an embedding of a user's interests derived from their history. These batch computations (perhaps using pandas or Spark) output results to S3, which are then loaded into Redis or a database. We might schedule these jobs daily or hourly. Feast (an open-source feature store) could be used to manage this ingestion, but given a single-developer project, we implement a simpler custom pipeline for now. Batch features are typically merged with stream features in the online store. Our design ensures that after each batch run, the online feature store is updated (e.g., via a CSV export that a small program reads and writes to Redis in bulk).

## Real-Time Features
The Flink jobs described earlier compute features like counts and rates continuously. They directly write to Redis on each update or at short intervals. For example, the Engagement Aggregator might update `post:XYZ -> {"1h_likes": 50}` every minute. By using Redis with keys per feature or hashes, these updates are atomic and efficient. We ensure each update operation includes the tenant context to avoid collisions across tenants.

## Serving Interface
The Ranking service will interact with the feature store through a simple interface. For instance, it can use a Redis client (with pipelining) to fetch all needed features for a given user and a set of item IDs in one go. To support this, we sometimes store pre-joined features: e.g., a user-specific score for an item (like a user-item affinity) could be precomputed and stored by item ID under the user's key. However, storing per user per item data doesn't scale well, so instead we compute such cross-features on the fly during ranking if needed.

## Consistency
We adopt a log-and-catch-up paradigm for feature consistency ([craft.faire.com](https://craft.faire.com/real-time-ranking-at-faire-part-2-the-feature-store-3f1013d3fe5d)). All source of truth events are in Kafka; if needed, we can recompute features by replaying events or via batch from the data lake. The feature store acts as a cache of the latest computed features. To guard against issues, we include monitoring for missing or stale features (see Observability).

## Security
Since features can include personal data, we restrict access to the feature store. Each service that needs Redis is allowed via security group. If multi-tenancy requires data separation, we could even use separate Redis clusters per tenant or Redis keyspace isolation and ACLs, though with a proper key prefix and tenant-aware logic, a single cluster suffices while maintaining logical isolation.

## Data Format & Catalog
See the [Feature Store Data Format & Catalog](feature-catalog.md) for detailed key structure, example JSON, and the full feature catalog table.

---

For implementation details, see the [Architecture](architecture.md) and [Ranking Models](ranking-models.md) docs. 