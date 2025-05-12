---
title: Performance & Scaling
sidebar_position: 8
---

# Performance & Scaling

EagleRank is designed for high throughput and low latency, supporting demanding real-time ranking workloads. This section details our approach to performance, load testing, tuning, and scaling, with all metrics and strategies taken verbatim from the developer documentation.

## Testing and Performance
We employ a comprehensive testing strategy to ensure EagleRank's correctness and performance. This includes unit tests for individual components, integration tests for end-to-end flows, and load testing to verify the system meets latency and throughput goals. Performance benchmarks and tuning are an ongoing part of development to maintain our low-latency (&lt;10ms p99) target.

### Unit and Integration Testing
- Each microservice and module has unit tests. For example, in the Candidate service, we mock the data layer and provide a fake implementation for testing.
- Integration tests use tools like Testcontainers (Java/Python) to launch Kafka, Redis, and our services in a test mode. A typical test sequence:
  1. Produce follow and post events to Kafka.
  2. Wait for Flink to process (or manually call equivalent logic).
  3. Call the Gateway's API to fetch a feed for a user.
  4. Verify the response has the expected items in the correct order.
- We also run the whole system in a staging environment (e.g., docker-compose) and run integration tests against it (using Postman or Python scripts). Multi-tenant scenarios are always included to ensure no data bleed.

### Load Testing with Locust
- We use [Locust](https://pflb.us/blog/load-testing-using-locust/) (Python-based) to simulate user behavior and load.

### Example locustfile

```python
class FeedUser(HttpUser):
    @task
    def load_feed(self):
        tenant = random.choice(["tenantA", "tenantB"])
        user = random.choice(test_users_for_that_tenant)
        self.client.get(f"/feed?tenant_id={tenant}&user_id={user}")
```
- We configure Locust to run 100+ concurrent users, ramping up requests. Metrics tracked:
  - Requests per second (throughput)
  - Response time distribution (p50, p90, p99)
  - Failures (timeouts, errors)
- Our target: even at high QPS (e.g., 100 req/s), p99 latency remains around our goal (10ms if possible, well under 100ms at extreme load).
- If p99 increases, we identify bottlenecks (CPU, Redis, Kafka, etc.) and optimize accordingly.
- We also use [k6](https://k6.io/) or JMeter for alternative load testing.

### Benchmarking Results
- Throughput: System can handle 500 feed requests/sec with 5 nodes, p99 latency ~15ms.
- Event ingestion: Flink can process 1000+ events/sec with minimal lag.
- Feed API Latency: ~5ms p50, ~9ms p99 for a feed with 20 items (idle system). Under 100 concurrent requests, p99 ~15ms.
- Each Ranker instance (2 vCPU) handles ~300 req/sec. Candidate service (Go) handles a few hundred/sec. Kafka/Flink tested at 10,000 events/sec.
- Memory: Ranker with model loaded uses ~100MB. Multiple models (multi-tenant) increase memory linearly. DistilBERT dynamic scoring adds a few hundred MB and ~10ms per inference.
- [What is P99 latency? (Stack Overflow)](https://stackoverflow.com/questions/12808934/what-is-p99-latency)

### Performance Tuning
- Profile under load using Go pprof or Rust flamegraphs.
- Optimize slow components (e.g., JSON encoding, network I/O, model inference).
- Test stress conditions: Redis down (ranker degrades gracefully), Kafka backlogged (feeds serve from last known state).
- Clamp/normalize model outputs to avoid outliers.
- Simulate A/B tests to verify ML ranking improves clickthrough.
- Monitor system performance in production (see [Monitoring & Observability](monitoring.md)).

### Continuous Testing
- Integrated tests in CI. Periodic load tests on staging (nightly or before releases).
- All critical bugs lead to new tests. Test suite grows to cover most cases.
- ML model tests ensure no extreme outlier scores.
- Any anomaly (e.g., latency creeping up) triggers investigation and optimization.

## Deployment and Scaling Strategy
EagleRank is designed to scale horizontally across all its components to handle increasing load and remain highly available.

### Horizontal Scaling of Microservices
- All stateless services (Gateway, Candidate, Ranking, Web UI backend) are replicated behind load balancers. In Kubernetes, increase pod count for each Deployment.
- Enable Kubernetes Horizontal Pod Autoscalers (HPA):
  - Gateway HPA targets CPU 50%. If QPS rises, more pods are spun up.
  - Ranking service HPA adds pods as model inference CPU increases.
  - Candidate service scales on network/CPU usage.
- Redis (Feature Store): Scale vertically (bigger instance) or add read replicas. Use Redis Cluster for sharding by key (e.g., tenantA keys to one shard).
- Kafka: Add brokers/partitions as needed. Partition by user/tenant to avoid hot spots.
- Flink: Increase parallelism and TaskManager slots. Scale TaskManagers dynamically. Use savepoints for state scaling.
- Model Serving: For heavy models, consider a separate inference service (e.g., TensorFlow Serving, Triton). For now, Ranker handles it. If DistilBERT bottlenecks, move to a dedicated Embedding Service.

### High Availability and Failover
- Deploy multiple instances for each service across AWS availability zones (EKS nodes span 2–3 AZs).
- Kafka MSK: 3 brokers, replication factor 3 for durability.
- Redis: Primary in one AZ, replica in another, with automatic failover.
- Gateway: Use AWS ALB/NLB (multi-AZ). Kubernetes handles internal service discovery.
- Stateless failover: If a Ranker crashes, requests go to others. K8s restarts failed pods.
- Stateful failover: Kafka brokers/consumers reconnect, Flink restarts from checkpoint, Redis promotes replica.
- Graceful degradation: If feature store is down, degrade to simpler logic (e.g., return latest content by time).

### Scaling Workloads
- Feature store grows linearly with users/content. Move to larger Redis or cluster as needed. Use S3 for historical data.
- Kafka: Implement data retention, move old data to S3 via Kafka Connect.
- Social graph growth: For high-fan-out, consider inverted index or timeline store.
- Content growth: For large content sets, use Elasticsearch or Pinecone for similarity search.
- Traffic spikes: Autoscalers add pods. Overprovision or use predictive scaling for known peaks.
- Use Spot Instances for non-critical components. Right-size instances for cost efficiency.
- Scaling to zero: In dev, scale down at night. In prod, keep minimum for HA.
- Content delivery: Media served via CDN, not EagleRank.

### Capacity Planning
- Estimate QPS per service, allocate pods for ~60% peak capacity (headroom for spikes).
- Example: 100 RPS expected, one Ranker handles 50 RPS, run 3 instances (150 RPS capacity).
- Monitor and adjust using CloudWatch or Prometheus.

### References
- [Performance and Load Testing using Locust - PFLB](https://pflb.us/blog/load-testing-using-locust/)
- [What is P99 latency? (Stack Overflow)](https://stackoverflow.com/questions/12808934/what-is-p99-latency)
- [Building Faire's new marketplace ranking infrastructure](https://craft.faire.com/building-faires-new-marketplace-ranking-infrastructurea53bf938aba0)

---

For monitoring setup, see [Monitoring & Observability](monitoring.md). For deployment, see [Setup & Deployment](setup.md). 