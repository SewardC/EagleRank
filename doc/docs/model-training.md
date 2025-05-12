---
title: Model Training and Inference
sidebar_position: 14
---

## Model Training and Inference

### Data Collection
Training data is continuously collected from user interaction logs. Each time a feed is shown and the user interacts (or doesn't), we generate labeled examples. For example, if user U was shown post X and they clicked it, that can be a positive label for (U,X) pair; if they ignored post Y, that might be a negative example. These events are either logged via Kafka (`EngagementEvent`) or through the gateway. We accumulate them in a data lake (S3 in CSV/Parquet or a warehouse table).

### Feature Label Join
Periodically (say daily), we run a batch job that joins these interaction logs with the corresponding features at the time of the event:
- We query the Feature Store (or use features computed in batch for that historical timestamp) to get the feature values for user U and item X at time of impression.
- Construct a training row: features..., label (clicked or not), perhaps weight etc.
- We produce a dataset of such rows. This is typically done in Python with pandas or Spark for large data. Because we want to iterate quickly as a single dev, we might sample or limit data (maybe last 30 days of data, or sample of users) to keep dataset size manageable (e.g., few million rows).

### Model Training (LightGBM)
We use LightGBM (a popular open-source gradient boosting framework) to train a ranking model. LightGBM is suitable for learning-to-rank or classification tasks with many features and can handle large datasets efficiently. We set up a training script (Python with LightGBM library) that:
- Reads the training data (from a file or database).
- Splits into training/validation.
- Defines the model as either a regression (predict relevance score) or binary classifier (predict probability of engagement) or using LightGBM's LambdaRank (for learning-to-rank with pairwise loss).
- We tune hyperparameters (tree count, depth, learning rate) empirically.

LightGBM can train quickly on CPU, utilizing multiple cores. If data is huge, we could use AWS SageMaker or a beefy EC2 instance to train, but likely on a dev machine or small EC2 it's fine for moderate data.

During training, we ensure to include tenant features or separate models as needed. If combining tenants' data, we include tenant_id as a categorical feature so the model can differentiate patterns per tenant.

### Model Evaluation
We evaluate on validation set using metrics like AUC (for binary classification) and NDCG or MAP (for ranking). We also perform manual inspection – e.g., ensure the feature importances from LightGBM make sense (we expect things like user_follows_author or post_age_hours to be among top importance). We might also simulate some ranking with the model to see if it aligns with intuition (like recent posts scoring higher ceteris paribus).

### Iteration
If results are not satisfactory (e.g., the model is favoring too much popular content and ignoring personalization), we refine features or parameters. Perhaps we add more features such as content embeddings or diversify training data.

### DistilBERT Embeddings
In addition to the core ranking model, we incorporate DistilBERT to handle content understanding. DistilBERT is a smaller, faster version of BERT that retains about 97% of BERT's language understanding capabilities while being 40% smaller and 60% faster ([huggingface.co](https://huggingface.co/)). We use DistilBERT in two ways:
- **Content Embeddings:** We feed post text (and maybe metadata) into a DistilBERT model (pre-trained, possibly fine-tuned on our domain) to get a fixed-length embedding vector (say 768-dimensional). This is done offline for each post when it's created (or periodically for new content). These embeddings (which capture semantic meaning) are stored as part of item features (either directly or reduced via PCA if needed). During candidate generation, we could use these to find similar posts (content-based recommendations). But primarily, during ranking, having the embedding allows computing similarity between user interests and item content.
- **User Embeddings:** We can also derive user embeddings by aggregating embeddings of content they liked. For example, average the vectors of last N posts the user engaged with – yielding a rough vector for "interests of user". This is also done offline or in streaming. The user's interest vector is stored as a feature. Then at ranking time, we compute dot product or cosine similarity between user vector and candidate post vector as a feature (the ranker model can then learn to use "if a post is similar to user's interests, boost it").

If needed, we can also fine-tune DistilBERT on a supervised task like predicting engagement from text, but that may be overkill for one developer. Instead, using it for representation is simpler and effective.

#### Training DistilBERT or Fine-tuning
If our content is domain-specific (say code snippets or medical text), we might fine-tune DistilBERT on domain data (or on a prediction of tags, etc.). We can use Hugging Face Transformers in Python to fine-tune on available labels (maybe hashtags or categories as supervision). But at the very least, we use pre-trained weights (like distilbert-base-uncased) for embeddings.

### Output of Training
The LightGBM model is saved as a text or binary model file. We then convert it to ONNX for consistency in serving. There is a tool (skl2onnx or LightGBM's built-in converter) that can convert the tree ensemble to an ONNX graph ([onnx.ai](https://onnx.ai/)). We test the ONNX model's outputs vs original to ensure correctness (very important to avoid discrepancies). DistilBERT model is large (~66M parameters), but we can also convert it to ONNX format for serving to avoid Python overhead. Hugging Face's optimum library or ONNX exporters can convert the transformer to ONNX, which can then be loaded by ONNX Runtime in the serving environment. In practice, we might decide to not serve DistilBERT live due to latency, and instead incorporate its results as features.

---

## Model Serving Setup

### ONNX Runtime Serving
We choose to integrate model inference into the Ranking service process using the ONNX Runtime library. This avoids network overhead calling an external model server. The LightGBM ONNX model is loaded at service start. ONNX Runtime will use CPU by default (we can enable multi-threading, and possibly vectorized instructions). Because tree models are memory-light and fast, this is fine. If we did incorporate a neural network in ONNX, ONNX Runtime can handle that too, possibly using MKL or OpenBLAS for acceleration. In the future, if GPU was needed, ONNX Runtime can use CUDA for neural nets (not applicable for LightGBM).

We ensure the Rust service properly manages the ONNX runtime environment (initialize once, reuse the session for each inference). We use batch inference: e.g., create input of shape (N, F) for N candidates and feed it in one go to get an output array of size N.

#### Alternate Approach (Triton)
For completeness, another approach to serving could be to use NVIDIA Triton Inference Server if we had multiple models or GPUs. Triton can serve LightGBM (via FIL backend or as an ensemble) and transformers (TensorRT). However, operating Triton might be too heavy for one dev initially, so we stick to embedding inference in our service. If traffic grows, we could separate the Model Serving as its own microservice (maybe running C++ code) and have the ranker call it, but that's not necessary until proven.

### Feature Engineering Strategies (in training)
It's worth noting some features require transformations:
- We take log of certain counts to reduce skew (the model can handle raw counts, but logs often make relationships more linear).
- Normalize features like time differences into reasonable ranges (e.g., age in hours clipped at 1000, or scaled between 0 and 1 by dividing by a constant).
- One-hot encode or target-encode categorical features (for LightGBM, we can input category as integer and tell it which features are categorical). For example, tenant_id or device_type can be treated as categorical.
- Generate interaction features: we explicitly add user_follows_author as a feature rather than leave the model to figure it out from separate bits, because it's a high-order interaction that's important. Another might be something like author_popularity * user_preference etc., but usually boosting can multiply if needed.

These transformations are implemented in both training and serving. We must mirror them exactly. To avoid training-serving skew, we do minimal on-the-fly math in serving (e.g., computing cosine similarity between user and item embedding is done at serve time – that's fine as it's a simple formula). Most heavy transformations like scaling or encoding are straightforward enough to do in code or even have the model intrinsically handle (LightGBM can handle monotonic transforms internally if the variables are input consistently).

### Continuous Learning
Over time, as more data comes in, we'd retrain the model periodically (perhaps nightly or weekly). Since this is a portfolio/solo project, schedule might be manual retrains when improvements are made. One could automate it with a cron job and have a CI/CD pipeline to deploy new models (after evaluation).

### Testing Inference
We test the integrated model by feeding known inputs and comparing output with our Python training predictions. This is critical to ensure our ONNX and feature assembly is correct. We'll for example take a few records from validation, run them through the Rust service locally (with a test harness) and see if the scores match LightGBM's predict output to within a tiny tolerance.

---

## Example Model Use-Cases

To illustrate, suppose user45 opens their feed. The system might gather 50 candidates, including:
- 30 posts from people they follow,
- 10 recommended posts (from DistilBERT-similar content to what they like),
- 10 trending posts.

For one candidate (say post XYZ by user67): The feature vector assembled could look like:

```csharp
[user_follower_count=50, user_following_count=55, user_click_rate=0.2,
item_age_hours=5, post_like_count=10, author_followers=100, user_follows_author=1,
content_similarity=0.8, tenant_id_feature=embedding(A), ...]
```

Feeding this to LightGBM yields a score of, say, 0.75. Another post might get 0.60, etc. The ranker sorts accordingly.

The inclusion of the content similarity (via DistilBERT embeddings) means if the post's content is about a topic the user has shown interest in, that feature will be high and boost the score. DistilBERT effectively provides a learned representation to capture topic-level relevance that our manual features might miss. 