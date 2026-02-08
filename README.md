# Blog Platform — Microservices Architecture

A blog platform built with microservices architecture, designed for deployment on AWS EKS.

## Architecture

- **Auth Service** (port 3001) — User registration, login, JWT-based authentication
- **Post Service** (port 3002) — CRUD operations for blog posts
- **Comment Service** (port 3003) — CRUD operations for comments
- **Frontend** — React + TypeScript + Vite, served via Nginx

## Tech Stack

- Node.js + Express + TypeScript (backend)
- React + TypeScript + Vite (frontend)
- MySQL + Prisma ORM
- Docker + Kubernetes (EKS)
- GitHub Actions (CI/CD)

## Local Development

### Prerequisites

- Node.js 20+
- Docker & Docker Compose

### Run with Docker Compose

```bash
docker-compose up --build
```

This starts MySQL, all three backend services, and the frontend.

### Run services individually

1. Start MySQL:
```bash
docker run -d -p 3306:3306 -e MYSQL_ROOT_PASSWORD=password mysql:8.0
```

2. Initialize databases:
```bash
mysql -h 127.0.0.1 -u root -ppassword < init-db.sql
```

3. Start each service:
```bash
cd services/auth-service && npm install && npx prisma db push && npx tsx src/index.ts
cd services/post-service && npm install && npx prisma db push && npx tsx src/index.ts
cd services/comment-service && npm install && npx prisma db push && npx tsx src/index.ts
cd frontend && npm install && npm run dev
```

## Deployment

See the `k8s/` directory for Kubernetes manifests and `.github/workflows/deploy.yaml` for CI/CD configuration.
