---
title: Setup & Deployment
sidebar_position: 2
---

# Setup & Deployment

This guide covers how to install, configure, and deploy EagleRank for local development, production, and CI/CD environments.

## Prerequisites
- **Node.js** (for Docusaurus docs)
- **Docker** (for local development and testing)
- **Kubernetes** (for production deployment)
- **Kafka & Flink** clusters (local or managed)
- **Python 3.8+** (for ML model training)

## Local Development
1. **Clone the repository:**
   ```bash
git clone https://github.com/your-org/eagle-rank
cd eagle-rank
```
2. **Start core services with Docker Compose:**
   ```bash
docker-compose up -d
```
3. **Run Docusaurus docs locally:**
   ```bash
yarn install
yarn start
```
4. **Access the docs:**
   - Open [http://localhost:3000](http://localhost:3000)

## Production Deployment
- **Kubernetes**: Use Helm charts or Kustomize for deploying EagleRank microservices, Kafka, and Flink clusters.
- **CI/CD**: Integrate with GitHub Actions or your preferred CI/CD tool ([reference](https://spacelift.io/blog/github-actions-kubernetes)).
- **Secrets Management**: Use AWS Secrets Manager or Kubernetes secrets ([reference](https://docs.aws.amazon.com/eks/latest/userguide/manage-secrets.html)).

## Configuration
- All services are configured via environment variables and config files (see `config/` directory).
- Example:
  ```env
KAFKA_BROKER=localhost:9092
FLINK_HOST=localhost:8081
FEATURE_STORE_URL=http://localhost:5000
```

## Cloud Providers
- EagleRank is cloud-agnostic and can run on AWS, GCP, or Azure.
- For managed Kafka (e.g., MSK) and Flink, see provider documentation.

## Monitoring & Observability
- Deploy Prometheus and Grafana for metrics and dashboards ([reference](https://navendu.me/posts/introduction-to-monitoring-microservices/)).
- Enable OpenTelemetry for distributed tracing.

---

For troubleshooting and advanced deployment, see the [Performance & Scaling](performance.md) and [Monitoring](monitoring.md) docs. 