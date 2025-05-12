---
title: Monitoring & Observability
sidebar_position: 7
---

# Monitoring & Observability

A production system requires robust observability to ensure it's operating correctly and to diagnose issues when they arise. EagleRank includes monitoring, logging, and tracing from day one ([craft.faire.com](https://craft.faire.com/building-faires-new-marketplace-ranking-infrastructurea53bf938aba0)). We leverage open-source tools like Prometheus, Grafana, and OpenTelemetry to achieve this.

## Metrics (Prometheus & Grafana)
We instrument each microservice and component with key Prometheus metrics ([navendu.me](https://navendu.me/posts/introduction-to-monitoring-microservices/)):
- **HTTP/gRPC Metrics:** The API Gateway records the number of requests, latency histogram, and success/error counts for each endpoint (e.g., `grpc_feed_requests_total{tenant="A", status="OK"}` and a histogram `grpc_feed_latency_seconds`). We use Prometheus client libraries (Go's promhttp for HTTP, and a custom measure around gRPC calls) to expose these.
- **Service Metrics:**
  - Candidate service reports how many candidates it typically fetches (`candidates_fetched_count`), and time taken to fetch and merge (so we know if that is a bottleneck).
  - Ranking service reports inference latency (`model_inference_ms`) and perhaps per-model metrics if multiple models. Also, cache hit/miss for features if we have layered caching.
- **Flink metrics:** We integrate with Flink's metrics if possible (Flink can be configured to expose to Prometheus). At least, we track Kafka consumer lags for our Flink jobs to ensure they are keeping up (e.g., if lag starts growing, something's wrong).
- **Infrastructure Metrics:** Kafka's broker metrics, JVM metrics of Flink, resource usage of pods (though these can be collected via Kubernetes/Prometheus integration). We set up alerts on high CPU or memory usage to catch leaks or spikes.
- **Feature Store Metrics:** e.g., Redis "get" latency and hits. We might instrument a small wrapper around Redis calls to measure how quickly features are fetched, and how often keys are missing (which could indicate outdated feature or bug).

Prometheus scrapes these metrics endpoints periodically (e.g., every 15s). We configure Prometheus either in Kubernetes (using Prometheus Operator) or use a hosted solution (like Grafana Cloud, if one dev doesn't want to maintain a Prom server – but we'll assume self-host for learning). The metrics are stored in Prometheus's time-series database.

**Grafana Dashboards:** We set up Grafana with dashboards visualizing:
- Overall Request Rates and Latencies: A panel showing feed request volume per tenant, and a latency heatmap or p99 line ([craft.faire.com](https://craft.faire.com/building-faires-new-marketplace-ranking-infrastructurea53bf938aba0)). For example, "Feed p99 latency = 25ms" ideally.
- Success vs Error: Graph of error rate (if any). If errors spiked, we'd see it clearly.
- Flink Processing: A dashboard with Kafka lag for each topic, and processing throughput (events per second). This helps ensure the streaming side is healthy.
- Resource usage: CPU/mem of each service, to see if we need to scale.
- Custom Metrics: For instance, number of candidates per request (so we know if candidate generation is under/over-fetching), or distribution of model scores (could be interesting to monitor if the model output distribution shifts, which might indicate concept drift).

Grafana allows setting alerts on queries. We might set alerts for:
- Feed latency p99 >, say, 100ms for 5 minutes (potential performance regression).
- Error rate > 1%.
- Kafka lag > some threshold (meaning Flink is not keeping up).
- No events processed for a while (maybe something stuck).

These alert triggers can be sent to email or a Slack (for a one-man operation, email might suffice).

## Logging
Each component emits structured logs. We use a consistent format (JSON logs with fields for timestamp, level, service, tenant, user_id (if applicable), message, etc.). For example, when a feed is served, the gateway logs a line like:

```json
{
  "ts": "2025-05-09T21:00:00Z", "level": "INFO", "service": "gateway",
  "tenant": "tenantA", "user": "user45",
  "event": "FeedServed", "num_items": 20, "latency_ms": 12
}
```

If an error occurs (say Ranker times out), it logs with level ERROR and includes stack trace.
We aggregate logs using Elastic Stack (ELK) or simpler, use CloudWatch logs if on AWS (or Loki+Grafana). Given scope, a fully managed solution like Amazon CloudWatch might be easiest – all Kubernetes pod logs go to CloudWatch via Fluent Bit, and we can search them there.

## Distributed Tracing (OpenTelemetry)
We integrate OpenTelemetry for distributed tracing across services ([dev.to](https://dev.to/siddhantkcode/the-mechanics-of-distributed-tracing-in-opentelemetry-1ohk)). We instrument the gateway to start a trace for each request, propagate context (using gRPC metadata) to the candidate and ranker services, which then attach their spans. This way, for one feed request, we can trace:
- Gateway span (overall) -> CandidateService span -> RankingService span -> (even internal model inference span). The trace will show timings for each segment. This is immensely helpful if, for example, feeds are slow – a trace can reveal if it was waiting on feature store or model inference etc.

We run an OpenTelemetry Collector (or use Jaeger) to collect and store traces. Jaeger can be deployed in K8s and store traces (we might sample say 1% of requests for tracing to keep overhead low). When debugging or testing, we can also increase sample.

Traces allow pinpointing issues in a distributed context that logs might not easily correlate. For example, we can see that a certain request had a 50ms pause in candidate service (maybe an external call). Or that for tenantB, every request shows an extra step (maybe calling an external recommendation API) that adds latency.

**Dashboards for ML:**
- Feature health: metrics or logs for features – e.g., average feature values, or a watchdog that checks if any feature is NaN or missing excessively.
- Model predictions: we can log model score distribution. Or periodically run the model on a sample input to ensure it's working (can detect if somehow the model output is degenerate).
- Drift detection: While advanced, we could have a cron job comparing recent feature distribution to training distribution (perhaps using Prometheus to record feature means). This would hint if our model might be seeing out-of-scope data.

## Alerting and Alerts Runbook
We set up Alertmanager (comes with Prometheus) to send notifications on certain triggers (as mentioned). As a single dev, we will route alerts to email or maybe a smartphone push. Key alerts:
- Service Down: If any service instance is not healthy (Kubernetes will handle restarting it, but we alert if e.g. it keeps crashing). Perhaps track if feed request success rate drops to 0 (which indicates gateway or downstream is down).
- Latency SLA breach: If p99 latency goes above 100ms consistently.
- Kafka/Flink issues: If Kafka lag > threshold or if Flink job fails (Flink can send metrics on job status or we integrate with its web UI alarms).
- High Error Rate: >5% errors for a period triggers urgent alert.

We document an Incident Playbook: e.g., if "Kafka lag high" alert, likely cause might be Flink slowed or died – check Flink logs or Flink UI for failure, possibly restart job. If "Feed latency high", check if it's candidate or ranker via traces, maybe Redis latency (could scale Redis or check network).

## Health Checks
Every microservice implements a health check endpoint:
- For gRPC, we implement the standard gRPC Health Checking protocol (so that Envoy or Kubernetes can query the service status). Our Gateway, Candidate, Ranker all implement a simple Check returning SERVING if ready.
- We also have liveness probes (just an HTTP GET /healthz that returns 200 if the app loop is running).
- The Flink job health is a bit different – we rely on Flink's own monitoring or at least ensure the Flink JobManager is up. In k8s, we check the jobmanager REST API maybe.
- Redis and Kafka have their own health – we rely on AWS MSK and ElastiCache monitoring for those but also our app can have a periodic self-check (the Ranker can periodically do a trivial Redis command and if it fails, mark itself unhealthy – causing k8s to restart or alert to fire if, say, Redis is down).

By having comprehensive observability, we make the system maintainable by one person. Problems can be quickly identified whether they are code bugs, performance regressions, or infrastructure failures. Moreover, the collected metrics and logs serve as evidence of the system's reliability and performance, which is useful when sharing the project (e.g., showing Grafana screenshots of system handling X events/sec with p99 latency Y).

In summary, EagleRank's monitoring ensures "as soon as anomalies occur, we detect and can react" ([navendu.me](https://navendu.me/posts/introduction-to-monitoring-microservices/)), building confidence in the system's operation for both the developer and any observers (like recruiters evaluating the thoroughness of the project).

---

For setup instructions, see [Setup & Deployment](setup.md). For performance tuning, see [Performance & Scaling](performance.md). 