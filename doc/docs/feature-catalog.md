---
title: Feature Store Data Format & Catalog
sidebar_position: 13
---

## Feature Store Data Format & Catalog

The feature store holds data often in simple key-value or key-hash forms:

For Redis, a common pattern is:
- Key: `tenant:{tenant_id}:user:{user_id}:features` with a hash of feature name to value.
- Key: `tenant:{tenant_id}:item:{item_id}:features` similarly for items.
- Some features might also be stored as sorted sets or counters for quick aggregation (e.g., `popularity_rank` might be a sorted set of item IDs by score).

If using a relational store for features (not in this design, but possible), we'd have tables like `user_features(tenant_id, user_id, feature_name, value)` (wide or tall schema).

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

We also consider data types: features can be numeric (int, float), categorical (which might be represented as an ID that the model will interpret via one-hot or embedding). For instance, tenant_id could be treated as a categorical feature with an embedding vector in a neural model, but for LightGBM we might just give it as an integer and rely on separate model instances or one-hot encoding if needed. Another example: content category might be an enum turned into multiple binary features.

**Contract:** We document each feature:
- Name, description, type, range.

For example:
- `likes_last_7d` – int – number of likes user gave in last 7 days (range 0–∞, skewed, perhaps we cap or log-transform).
- `item_age_hours` – float – age in hours of the content (small positive).
- `user_follows_author` – binary 0/1 – whether the user is following the item's author (crucial feature).
- `author_followers` – int – number of followers the author has (popularity of author).

These definitions align with how data is populated in the feature store (via Flink or batch). Maintaining this as a central feature catalog (could be a simple Markdown in the repo or a JSON spec) is important so that when training a model or debugging, one knows what each feature means.

**Example of Feature Catalog (snippet):**

| Feature Name        | Entity         | Source     | Description                        |
|--------------------|---------------|------------|------------------------------------|
| follower_count     | User          | real-time  | Number of followers the user has   |
| following_count    | User          | real-time  | Number of accounts the user follows|
| user_click_rate    | User          | batch      | 30-day CTR of user (clicks/views)  |
| post_like_count    | Item          | real-time  | Number of likes the post received  |
| post_age_hours     | Item          | real-time  | Age of post in hours (now - posted)|
| user_follows_author| User-Item pair| derived    | 1 if the user follows the author   |

This catalog is used in code to extract features for model input and also in training scripts to select and verify features.

By rigorously defining API contracts and schemas as above, we ensure each part of EagleRank (as well as external tenant integrations) operate on a consistent understanding of the data structures, reducing integration bugs and easing future extensions. 