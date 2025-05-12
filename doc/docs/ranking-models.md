---
title: Ranking Models
sidebar_position: 4
---

# Ranking Models

EagleRank uses advanced machine learning models to score and rank feed items in real time, supporting both tree-based and deep learning approaches for maximum flexibility and performance.

## Model Architecture

The core ranking pipeline is a two-stage model:
- **LightGBM**: A gradient boosting model for primary scoring, using a variety of user, item, and context features ([LightGBM](https://github.com/onnx/onnxmltools/issues/338)).
- **DistilBERT**: A lightweight transformer for semantic content understanding ([DistilBERT](https://huggingface.co/papers/1910.01108)).
- **Hybrid**: LightGBM handles structured/tabular features, while DistilBERT provides embeddings for unstructured text. DistilBERT outputs are used as features in LightGBM or as a secondary re-ranker.

## Algorithm Taxonomy in EagleRank

Not all algorithms in EagleRank are strictly "machine learning". The core algorithmic framework can be divided into three main categories: graph-based/scoring functions, retrieval/indexing, supervised ML/ranking, and online statistical/reinforcement methods. The following table summarizes the main approaches:

| Algorithm                                      | Category                | ML Dependency         | Role/Usage                                                                 | Notes                                                                                       |
|------------------------------------------------|-------------------------|-----------------------|----------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| Weighted-PageRank + Time Decay (增量 Weighted-PageRank + 时间衰减) | Graph/Scoring Function | No                    | Flink streaming updates node weights in real time; adjusts influence per author/node | Purely graph-based, not ML; measures author/node influence; can use features but not a model |
| HNSW Approximate Nearest Neighbor (HNSW 近似最近邻检索) | Retrieval/Indexing     | Partially (for embeddings) | Fast candidate selection for "content similarity" or "interest similarity" | HNSW itself is not ML, but uses ML-based embeddings (e.g., DistilBERT) as input             |
| Two-stage Learning-to-Rank (两阶段 Learning-to-Rank); GBDT (LightGBM LambdaRank); DistilBERT Interaction Model | Supervised ML          | Yes                   | First stage narrows hundreds of candidates to dozens; second stage does fine-grained semantic ranking | GBDT: tree model, structured features; DistilBERT: transformer, text interaction or external features |
| Thompson Sampling / Multi-armed Bandit (Thompson Sampling / 多臂 Bandit 重排序器) | Online Statistics / RL | Statistical-ML method | Explore-exploit in final ranking; gives cold-start content exposure         | Uses posterior/Beta distribution to estimate click rates; online learning                   |

These methods are combined in EagleRank's pipeline to balance relevance, diversity, and exploration, leveraging both classic algorithms and modern ML.

## Features Used
- **User features**: Activity level, preferences, similarity to item's author, follower count.
- **Item features**: Content age, type, popularity (likes, reshares).
- **Interaction features**: Whether user follows author, past interactions, content similarity.
- **Context features**: Time of day, device type, tenant context.

All features are fetched from the Feature Store and assembled in-memory for each candidate. Feature order and types are strictly maintained to match model training.

## Model Training
- **Data Collection**: User interactions (clicks, views) are logged and joined with features at the time of event.
- **Training Pipeline**: Use Python (LightGBM, pandas, Spark) to build datasets. Train LightGBM for ranking/classification (LambdaRank, binary, or regression loss). Tune hyperparameters empirically.
- **Multi-Tenancy**: Either include `tenant_id` as a categorical feature (one global model) or train separate models per tenant. Model selection is configurable at runtime.
- **Evaluation**: Metrics include AUC, NDCG, MAP. Feature importances are checked for sanity. Simulate ranking to ensure model aligns with intuition.
- **DistilBERT Embeddings**: Used for content and user representation. Content embeddings are generated offline and stored as item features. User embeddings are aggregated from content the user engaged with. Optionally, fine-tune DistilBERT for domain-specific tasks.
- **Export**: LightGBM models are exported to ONNX for serving. DistilBERT can also be exported to ONNX using Hugging Face tools.

## Model Serving
- **ONNX Runtime**: Models are loaded into the Ranking service (Rust) using ONNX Runtime for fast, batch inference. Batch all candidates for a user to maximize throughput.
- **Deployment**: Models are loaded at service startup (from S3 or local volume). Model selection is keyed by tenant if needed. Optionally, use NVIDIA Triton for large-scale or GPU inference, but ONNX Runtime is default for simplicity.
- **Feature Engineering at Serve Time**: Minimal transformations (e.g., cosine similarity, log transforms) are performed in code. All heavy transformations are mirrored from training to serving to avoid skew.
- **Business Rules**: Post-processing can enforce diversity, recency, or tenant-specific rules (e.g., pinning items, limiting posts per author).

## Example Proto (gRPC API)
```proto
service FeedRanker {
  rpc GetFeed(FeedRequest) returns (FeedResponse);
}
message FeedRequest {
  string tenant_id;
  string user_id;
  uint32 max_results;
}
message FeedItem {
  string item_id;
  string author_id;
  double score;
  // ...other metadata
}
message FeedResponse {
  repeated FeedItem items;
}
```

## Example Feature Vector
```text
[user_follower_count=50, user_following_count=55, user_click_rate=0.2, item_age_hours=5, post_like_count=10, author_followers=100, user_follows_author=1, content_similarity=0.8, tenant_id_feature=embedding(A), ...]
```

## Best Practices
- Monitor model latency and throughput (see [Performance & Scaling](performance.md)).
- Use feature versioning and metadata for reproducibility.
- A/B test new models and ranking strategies.
- Test ONNX outputs against Python predictions for correctness.
- Retrain models periodically as new data arrives.

## References
- [LightGBM ONNX Export](http://onnx.ai/sklearn-onnx/auto_examples/plot_pipeline_lightgbm.html)
- [DistilBERT Paper](https://huggingface.co/papers/1910.01108)
- [Mastering Feed Ranking Models with Machine Learning](https://medium.com/nextgenllm/ml-feed-ranking-model-105703c63c40)
- [Building Faire's new marketplace ranking infrastructure](https://craft.faire.com/building-faires-new-marketplace-ranking-infrastructurea53bf938aba0)

---

For API details, see the [API Reference](api.md). For feature engineering, see the [Feature Store](feature-store.md). 