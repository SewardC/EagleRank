---
title: API and Data Contracts
sidebar_position: 12
---

## API and Data Contracts

A clear definition of APIs and data schemas ensures that all components (and tenants) integrate correctly. We describe here the gRPC API contracts, Kafka message schemas, and the feature data formats.

### gRPC API Definitions

EagleRank's internal APIs are defined with Protocol Buffers (.proto files) for strong typing and easy generation of client/server code. The external facing API (via the Gateway) includes:

- `GetFeed(FeedRequest) -> FeedResponse` — retrieves a ranked feed for a user.
- `ListTenants()` (admin) — perhaps to list available tenants or system status (for management).
- We could also have methods like `LogEvent(EventRequest)` to allow clients to send interaction events (if they send directly rather than through Kafka – but in our design clients don't talk directly to Kafka, so this might be a convenience in some cases).

Example FeedRequest and FeedResponse in proto (for external API):

```proto
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

For the internal gRPC between services:

**CandidateService:**

```proto
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

```proto
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

Using protobuf ensures our data contracts are language-agnostic and versioned. For example, if we add a new field to FeedItem (say, `category`), older clients simply ignore it if unknown.

We also define message types for the events (though events are carried by Kafka, defining them in proto or Avro serves a similar documentation purpose):

---

### Kafka Message Schemas

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