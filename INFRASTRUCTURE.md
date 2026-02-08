# Infrastructure & Deployment Guide

This document covers everything about how the blog platform works, what each piece of infrastructure does, and how to deploy it on AWS.

---

## Table of Contents

1. [How the Application Works](#how-the-application-works)
2. [Environment Variables](#environment-variables)
3. [Docker Setup (Local)](#docker-setup-local)
4. [Kubernetes Architecture](#kubernetes-architecture)
5. [AWS Infrastructure](#aws-infrastructure)
6. [Deployment Steps](#deployment-steps)
7. [CI/CD Pipeline](#cicd-pipeline)
8. [Why This Architecture](#why-this-architecture)

---

## How the Application Works

The platform is split into 4 independently deployable units:

```
User's Browser
      │
      ▼
┌─────────────────────────────────────────────────┐
│              AWS ALB (Load Balancer)             │
│         blog.yourdomain.com (Route 53)          │
└──────┬──────────┬──────────┬──────────┬─────────┘
       │          │          │          │
  /api/auth  /api/posts /api/comments   /
       │          │          │          │
       ▼          ▼          ▼          ▼
  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
  │  Auth  │ │  Post  │ │Comment │ │Frontend│
  │Service │ │Service │ │Service │ │(Nginx) │
  │ :3001  │ │ :3002  │ │ :3003  │ │  :80   │
  └───┬────┘ └───┬────┘ └───┬────┘ └────────┘
      │          │          │
      │    ┌─────┴──────────┘
      │    │  (validate JWT tokens via
      │◄───┘   http://auth-service:3001/api/auth/me)
      │
      ▼
┌─────────────────────────────────────┐
│          MySQL (Amazon RDS)         │
│  auth_db  │  posts_db  │ comments_db│
└─────────────────────────────────────┘
```

**Request flow example — creating a post:**
1. User clicks "Publish" in the React frontend
2. Frontend sends `POST /api/posts` with JWT token in the `Authorization` header
3. ALB sees the `/api/posts` path and routes to **Post Service**
4. Post Service's auth middleware extracts the token and calls **Auth Service** at `http://auth-service:3001/api/auth/me`
5. Auth Service verifies the JWT, looks up the user in `auth_db`, returns `{ id, name, email }`
6. Post Service attaches the user to the request, creates the post in `posts_db`
7. Response flows back to the browser

Each service **only** talks to its own database. Services communicate with each other over HTTP using Kubernetes internal DNS.

---

## Environment Variables

### Auth Service (port 3001)

| Variable | Purpose | Local Value | Production Value |
|----------|---------|-------------|-----------------|
| `PORT` | Server listen port | `3001` | `3001` |
| `DATABASE_URL` | Prisma connection to `auth_db` | `mysql://root:password@mysql:3306/auth_db` | From K8s Secret `blog-secrets` key `db-auth-url` → points to RDS |
| `JWT_SECRET` | Key used to sign/verify JWT tokens | `dev-secret-key` | From K8s Secret `blog-secrets` key `jwt-secret` → strong random string |

### Post Service (port 3002)

| Variable | Purpose | Local Value | Production Value |
|----------|---------|-------------|-----------------|
| `PORT` | Server listen port | `3002` | `3002` |
| `DATABASE_URL` | Prisma connection to `posts_db` | `mysql://root:password@mysql:3306/posts_db` | From K8s Secret `blog-secrets` key `db-posts-url` → points to RDS |
| `AUTH_SERVICE_URL` | Base URL to call Auth Service for token validation | `http://auth-service:3001` (Docker network) | `http://auth-service:3001` (K8s DNS) |

### Comment Service (port 3003)

| Variable | Purpose | Local Value | Production Value |
|----------|---------|-------------|-----------------|
| `PORT` | Server listen port | `3003` | `3003` |
| `DATABASE_URL` | Prisma connection to `comments_db` | `mysql://root:password@mysql:3306/comments_db` | From K8s Secret `blog-secrets` key `db-comments-url` → points to RDS |
| `AUTH_SERVICE_URL` | Base URL to call Auth Service for token validation | `http://auth-service:3001` (Docker network) | `http://auth-service:3001` (K8s DNS) |

### Frontend (build-time only)

| Variable | Purpose | Local Value | Production Value |
|----------|---------|-------------|-----------------|
| `VITE_API_URL` | Single base URL for all API calls | Not set | `https://blog.yourdomain.com` (set at Docker build time) |
| `VITE_AUTH_API_URL` | Auth service URL (dev only) | `http://localhost:3001` | Not needed — ALB routes by path |
| `VITE_POSTS_API_URL` | Post service URL (dev only) | `http://localhost:3002` | Not needed |
| `VITE_COMMENTS_API_URL` | Comment service URL (dev only) | `http://localhost:3003` | Not needed |

**Key difference:** In local dev, the frontend needs 3 separate URLs because there's no load balancer. In production, the ALB handles path-based routing, so one URL is enough.

**Key security note:** `DATABASE_URL` and `JWT_SECRET` contain credentials. Locally they're hardcoded in `docker-compose.yaml` for convenience. In production they're stored in a Kubernetes Secret and injected via `secretKeyRef` — never baked into the image.

---

## Docker Setup (Local)

### What `docker-compose up` does

```
1. Starts MySQL 8.0 container
   - Runs init-db.sql to create auth_db, posts_db, comments_db
   - Healthcheck: mysqladmin ping every 10s

2. Once MySQL is healthy → starts Auth Service
   - Builds from services/auth-service/Dockerfile
   - Runs: prisma db push (creates tables) → node dist/index.js

3. Once Auth Service starts → starts Post Service + Comment Service (in parallel)
   - Both wait for MySQL healthy + Auth Service started
   - Same pattern: prisma db push → node dist/index.js

4. Once all backends start → starts Frontend
   - Builds React app with Vite → serves via Nginx
```

### Dockerfiles — multi-stage builds

Each backend Dockerfile has two stages to keep production images small:

```
Build Stage (node:20-alpine):          Production Stage (node:20-alpine):
┌──────────────────────────┐          ┌──────────────────────────┐
│ Install OpenSSL          │          │ Install OpenSSL          │
│ Copy package.json        │          │ Copy dist/ (compiled JS) │
│ npm install (all deps)   │   ──►   │ Copy node_modules/       │
│ Copy source code         │          │ Copy prisma/             │
│ prisma generate          │          │ CMD: node dist/index.js  │
│ tsc (compile TypeScript) │          │                          │
│                          │          │ ~150MB (no TS, no src)   │
│ ~400MB (with devDeps)    │          └──────────────────────────┘
└──────────────────────────┘
```

The frontend uses a similar pattern but its production stage is `nginx:alpine` (~30MB) serving static files.

---

## Kubernetes Architecture

### What is a Namespace?

A namespace is a virtual cluster inside your EKS cluster. All our resources live in the `blog` namespace, keeping them isolated from other apps that might run on the same cluster.

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: blog
```

### What is a Secret?

A Secret stores sensitive data (passwords, tokens, connection strings) encoded in the cluster. Pods reference secret keys as environment variables — the values never appear in deployment manifests or Docker images.

```yaml
# k8s/secrets.yaml — stores 4 secrets:
jwt-secret       → used by Auth Service to sign JWTs
db-auth-url      → mysql://admin:<pwd>@<rds-endpoint>:3306/auth_db
db-posts-url     → mysql://admin:<pwd>@<rds-endpoint>:3306/posts_db
db-comments-url  → mysql://admin:<pwd>@<rds-endpoint>:3306/comments_db
```

### What is a Deployment?

A Deployment tells Kubernetes "run N copies of this container and keep them running." If a pod crashes, the Deployment controller automatically replaces it.

Each of our 4 services has a Deployment:

| Deployment | Replicas | Image | Port | CPU Request | Memory Request | CPU Limit | Memory Limit |
|------------|----------|-------|------|-------------|----------------|-----------|--------------|
| auth-service | 2 | blog-auth-service | 3001 | 100m | 128Mi | 250m | 256Mi |
| post-service | 2 | blog-post-service | 3002 | 100m | 128Mi | 250m | 256Mi |
| comment-service | 2 | blog-comment-service | 3003 | 100m | 128Mi | 250m | 256Mi |
| frontend | 2 | blog-frontend | 80 | 50m | 64Mi | 100m | 128Mi |

**Total initial pods: 8** (2 per service)

**Resource requests vs limits:**
- **Request** = guaranteed minimum. The K8s scheduler uses this to decide which node to place the pod on.
- **Limit** = hard ceiling. If a pod exceeds its memory limit, it gets killed (OOMKilled). If it exceeds CPU, it gets throttled.

### Health Checks (Probes)

Each backend Deployment has two probes that hit the `/health` endpoint:

- **Liveness Probe** — "Is this pod alive?" Checked every 10s after a 15s initial delay. If it fails, Kubernetes restarts the pod.
- **Readiness Probe** — "Is this pod ready to receive traffic?" Checked every 5s after a 5s initial delay. If it fails, the pod is removed from the Service's load balancing pool until it passes again.

This means zero-downtime deployments: new pods must pass readiness before receiving traffic, and old pods are only terminated after new ones are ready.

### What is a Service?

A Service gives a stable DNS name and IP address to a set of pods. All our Services are `ClusterIP` type, meaning they're only accessible inside the cluster.

```
┌──────────────────────────────────────────────────┐
│                  K8s Cluster                     │
│                                                  │
│  Service: auth-service (ClusterIP)               │
│  DNS: auth-service.blog.svc.cluster.local        │
│  Short form: auth-service (same namespace)       │
│       │                                          │
│       ├──► auth-service pod #1 (10.0.1.15:3001) │
│       └──► auth-service pod #2 (10.0.1.16:3001) │
│                                                  │
│  When post-service calls http://auth-service:3001│
│  K8s DNS resolves it and load-balances between   │
│  the two pods automatically.                     │
└──────────────────────────────────────────────────┘
```

This is how inter-service communication works — `AUTH_SERVICE_URL=http://auth-service:3001` resolves via Kubernetes DNS. No hardcoded IPs needed.

### What is an HPA (Horizontal Pod Autoscaler)?

An HPA watches pod CPU usage and scales replicas up or down automatically:

| HPA | Min Pods | Max Pods | Scale-up Trigger |
|-----|----------|----------|-----------------|
| auth-service-hpa | 2 | 5 | CPU > 70% average |
| post-service-hpa | 2 | 5 | CPU > 70% average |
| comment-service-hpa | 2 | 5 | CPU > 70% average |

If auth-service pods average 85% CPU, the HPA adds more pods (up to 5). When traffic drops, it scales back down to 2. The frontend doesn't have an HPA because it serves static files and rarely needs to scale.

### What is the Ingress?

The Ingress is the entry point — it tells the AWS ALB how to route external traffic to internal services:

```
Internet → ALB (blog.yourdomain.com)
                │
                ├── /api/auth/*      → auth-service:3001
                ├── /api/posts/*     → post-service:3002
                ├── /api/comments/*  → comment-service:3003
                └── /*               → frontend:80
```

Key annotations on our Ingress:
- `scheme: internet-facing` — ALB gets a public IP
- `target-type: ip` — ALB sends traffic directly to pod IPs (faster than going through NodePort)
- `listen-ports: [{"HTTPS":443}]` — only accepts HTTPS
- `certificate-arn` — uses an ACM SSL certificate for TLS
- `ssl-redirect: "443"` — HTTP automatically redirects to HTTPS

### Full picture inside the cluster

```
                         Internet
                            │
                   ┌────────▼────────┐
                   │   AWS ALB       │
                   │ (Ingress rules) │
                   └──┬───┬───┬───┬──┘
                      │   │   │   │
           ┌──────────┘   │   │   └──────────┐
           ▼              ▼   ▼              ▼
    ┌─────────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐
    │auth-service │ │post-svc  │ │comment-svc   │ │frontend  │
    │  Service    │ │ Service  │ │  Service     │ │ Service  │
    │(ClusterIP)  │ │(ClusterIP│ │ (ClusterIP)  │ │(ClusterIP│
    └──┬─────┬────┘ └──┬────┬─┘ └──┬─────┬────┘ └──┬────┬──┘
       │     │         │    │       │     │         │    │
       ▼     ▼         ▼    ▼       ▼     ▼         ▼    ▼
     Pod1  Pod2     Pod1  Pod2    Pod1  Pod2      Pod1  Pod2
    (3001) (3001)  (3002)(3002)  (3003)(3003)    (80)  (80)
       │     │         │    │       │     │
       └──┬──┘         └──┬─┘       └──┬──┘
          │               │            │
          ▼               ▼            ▼
    ┌─────────────────────────────────────┐
    │     Amazon RDS (MySQL 8.0)         │
    │  auth_db  │  posts_db  │ comments_db│
    └─────────────────────────────────────┘
```

---

## AWS Infrastructure

Here's every AWS service used and why:

| AWS Service | What It Does | Why We Need It |
|-------------|-------------|----------------|
| **EKS** (Elastic Kubernetes Service) | Managed Kubernetes control plane | Runs our containers without managing K8s master nodes ourselves |
| **EC2** (via EKS node group) | Worker nodes where pods run | The actual compute that runs our Docker containers |
| **ECR** (Elastic Container Registry) | Private Docker image registry | Stores our built Docker images close to EKS for fast pulls |
| **RDS** (Relational Database Service) | Managed MySQL 8.0 | Runs our 3 databases with automated backups, no DB admin needed |
| **ALB** (Application Load Balancer) | Layer 7 load balancer with path routing | Routes `/api/auth`, `/api/posts`, `/api/comments`, `/` to correct services |
| **ACM** (Certificate Manager) | Free SSL/TLS certificates | HTTPS for `blog.yourdomain.com` — auto-renews |
| **Route 53** | DNS management | Points `blog.yourdomain.com` to the ALB |
| **IAM** | Access control | Service accounts for EKS nodes to pull from ECR, ALB controller permissions |

---

## Deployment Steps

### Phase 1: AWS Infrastructure Setup (one-time)

**1. Create ECR repositories**
```bash
aws ecr create-repository --repository-name blog-auth-service --region ap-south-1
aws ecr create-repository --repository-name blog-post-service --region ap-south-1
aws ecr create-repository --repository-name blog-comment-service --region ap-south-1
aws ecr create-repository --repository-name blog-frontend --region ap-south-1
```

**2. Create RDS MySQL instance**
```bash
aws rds create-db-instance \
  --db-instance-identifier blog-mysql \
  --engine mysql \
  --engine-version 8.0 \
  --db-instance-class db.t3.micro \
  --allocated-storage 20 \
  --master-username admin \
  --master-user-password <STRONG_PASSWORD> \
  --vpc-security-group-ids <SG_ID> \
  --region ap-south-1
```
Then connect and create databases:
```sql
CREATE DATABASE auth_db;
CREATE DATABASE posts_db;
CREATE DATABASE comments_db;
```

**3. Create EKS cluster**
```bash
eksctl create cluster \
  --name blog-cluster \
  --region ap-south-1 \
  --nodes 2 \
  --node-type t3.medium \
  --managed
```
This creates the cluster, node group, VPC, subnets, and configures kubectl — takes ~15 minutes.

**4. Install AWS Load Balancer Controller**
```bash
# Associate OIDC provider (needed for IAM roles for service accounts)
eksctl utils associate-iam-oidc-provider --cluster blog-cluster --approve --region ap-south-1

# Create IAM policy for the controller
curl -o iam_policy.json https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v2.7.1/docs/install/iam_policy.json
aws iam create-policy --policy-name AWSLoadBalancerControllerIAMPolicy --policy-document file://iam_policy.json

# Create service account
eksctl create iamserviceaccount \
  --cluster blog-cluster \
  --namespace kube-system \
  --name aws-load-balancer-controller \
  --attach-policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/AWSLoadBalancerControllerIAMPolicy \
  --approve

# Install via Helm
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system \
  --set clusterName=blog-cluster \
  --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
```

**5. SSL Certificate + DNS**
```bash
# Request certificate
aws acm request-certificate \
  --domain-name blog.yourdomain.com \
  --validation-method DNS \
  --region ap-south-1

# Create Route 53 hosted zone (if not exists)
aws route53 create-hosted-zone --name yourdomain.com --caller-reference $(date +%s)

# Add the CNAME validation record from ACM to Route 53 to verify domain ownership
# After validation, note the certificate ARN for the Ingress manifest
```

### Phase 2: Configure Manifests

**1. Update `k8s/secrets.yaml`** with real values:
```yaml
stringData:
  jwt-secret: "<GENERATE_RANDOM_64_CHAR_STRING>"
  db-auth-url: "mysql://admin:<RDS_PASSWORD>@<RDS_ENDPOINT>.rds.amazonaws.com:3306/auth_db"
  db-posts-url: "mysql://admin:<RDS_PASSWORD>@<RDS_ENDPOINT>.rds.amazonaws.com:3306/posts_db"
  db-comments-url: "mysql://admin:<RDS_PASSWORD>@<RDS_ENDPOINT>.rds.amazonaws.com:3306/comments_db"
```

**2. Update image references** in all 4 deployment YAMLs:
Replace `<AWS_ACCOUNT_ID>` and `<REGION>` with your actual values, e.g.:
```
123456789012.dkr.ecr.ap-south-1.amazonaws.com/blog-auth-service:v1
```

**3. Update `k8s/ingress.yaml`**:
- Replace `<ACM_CERTIFICATE_ARN>` with your certificate ARN
- Replace `blog.yourdomain.com` with your actual domain

### Phase 3: Build and Push Images

```bash
# Login to ECR
aws ecr get-login-password --region ap-south-1 | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com

# Build and push each service
REGISTRY=<ACCOUNT_ID>.dkr.ecr.ap-south-1.amazonaws.com

docker build -t $REGISTRY/blog-auth-service:v1 ./services/auth-service
docker push $REGISTRY/blog-auth-service:v1

docker build -t $REGISTRY/blog-post-service:v1 ./services/post-service
docker push $REGISTRY/blog-post-service:v1

docker build -t $REGISTRY/blog-comment-service:v1 ./services/comment-service
docker push $REGISTRY/blog-comment-service:v1

docker build --build-arg VITE_API_URL=https://blog.yourdomain.com -t $REGISTRY/blog-frontend:v1 ./frontend
docker push $REGISTRY/blog-frontend:v1
```

### Phase 4: Deploy to EKS

```bash
# Point kubectl to your cluster
aws eks update-kubeconfig --name blog-cluster --region ap-south-1

# Apply in order (namespace first, then secrets, then services)
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/secrets.yaml
kubectl apply -f k8s/auth-service/
kubectl apply -f k8s/post-service/
kubectl apply -f k8s/comment-service/
kubectl apply -f k8s/frontend/
kubectl apply -f k8s/ingress.yaml

# Run database migrations (one-time, from a temporary pod)
kubectl run prisma-migrate --rm -it --restart=Never -n blog \
  --image=$REGISTRY/blog-auth-service:v1 \
  --env="DATABASE_URL=mysql://admin:<pwd>@<rds-endpoint>:3306/auth_db" \
  -- npx prisma db push

kubectl run prisma-migrate --rm -it --restart=Never -n blog \
  --image=$REGISTRY/blog-post-service:v1 \
  --env="DATABASE_URL=mysql://admin:<pwd>@<rds-endpoint>:3306/posts_db" \
  -- npx prisma db push

kubectl run prisma-migrate --rm -it --restart=Never -n blog \
  --image=$REGISTRY/blog-comment-service:v1 \
  --env="DATABASE_URL=mysql://admin:<pwd>@<rds-endpoint>:3306/comments_db" \
  -- npx prisma db push
```

### Phase 5: Verify

```bash
# Check pods are running
kubectl get pods -n blog

# Check services
kubectl get svc -n blog

# Check ingress (wait 2-3 min for ALB provisioning)
kubectl get ingress -n blog

# Check HPA
kubectl get hpa -n blog

# Point Route 53 to the ALB DNS name from the ingress output
# Then test
curl https://blog.yourdomain.com/health
curl https://blog.yourdomain.com/api/auth/health
```

---

## CI/CD Pipeline

After the initial deployment, the GitHub Actions workflow (`.github/workflows/deploy.yaml`) automates everything on push to `main`.

### How it works

```
Developer pushes to main
         │
         ▼
┌─────────────────────────┐
│  detect-changes job     │
│  (dorny/paths-filter)   │
│                         │
│  Changed files:         │
│  services/auth-service/ │ → auth = true
│  services/post-service/ │ → post = true
│  frontend/              │ → frontend = true
│  (comment unchanged)    │ → comment = false
└────┬──────┬──────┬──────┘
     │      │      │
     ▼      ▼      ▼
  ┌──────┐ ┌──────┐ ┌────────┐
  │Build │ │Build │ │Build   │  ← Only changed services build
  │Auth  │ │Post  │ │Frontend│
  │      │ │      │ │        │
  │Push  │ │Push  │ │Push    │  ← Push to ECR with git SHA tag
  │to ECR│ │to ECR│ │to ECR  │
  │      │ │      │ │        │
  │Deploy│ │Deploy│ │Deploy  │  ← kubectl set image (rolling update)
  │to EKS│ │to EKS│ │to EKS │
  └──────┘ └──────┘ └────────┘
```

**Key features:**
- **Only rebuilds what changed** — if you only edit auth-service, only auth-service gets built and deployed
- **Images tagged with git SHA** — every deployment is traceable to an exact commit
- **Rolling updates** — `kubectl set image` triggers a rolling update: new pods start, pass readiness, then old pods terminate. Zero downtime.

### Required GitHub Secrets

Add these in your repo's Settings > Secrets and variables > Actions:

| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | IAM user access key with ECR push + EKS access |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret key |

---

## Why This Architecture

### Why microservices instead of a monolith?
For a blog this size, a monolith would be simpler. We chose microservices because this is a **DevOps learning project**. The architecture demonstrates:
- Independent deployments (update auth without touching posts)
- Service discovery via Kubernetes DNS
- Inter-service HTTP communication
- Database-per-service pattern
- Container orchestration with scaling

### Why separate databases?
Each service owns its data. Auth service never queries `posts_db`. This enforces loose coupling — services can only interact through APIs, not by reaching into each other's tables.

### Why ALB instead of Nginx Ingress?
ALB is AWS-native. It integrates with ACM (free SSL), WAF (security rules), and CloudWatch (monitoring) out of the box. No extra Nginx pods to manage.

### Why ClusterIP services (not NodePort/LoadBalancer)?
All external traffic flows through the single ALB Ingress. Internal services don't need external access — they talk to each other via ClusterIP + Kubernetes DNS. This is more secure (smaller attack surface) and cheaper (one ALB vs four).

### Why HPAs on backends but not frontend?
Backend services do CPU-intensive work (JWT verification, database queries, bcrypt hashing). The frontend just serves static files from Nginx — it barely uses CPU even under heavy load.

### What does this cost on AWS?
Rough estimates (ap-south-1 region):
- EKS control plane: ~$73/month
- 2x t3.medium EC2 nodes: ~$60/month
- RDS db.t3.micro: ~$15/month
- ALB: ~$16/month + data transfer
- **Total: ~$165/month** for a fully production-ready setup

For learning, you can scale down to 1 node and a smaller RDS instance to reduce costs. Remember to delete the cluster when not in use.
