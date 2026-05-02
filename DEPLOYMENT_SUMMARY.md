# Blog Platform Deployment Summary - AWS EKS

This document summarizes the architecture, deployment steps, and troubleshooting procedures used to launch the blog platform on AWS EKS.

---

## 🏗️ Architecture Overview

The application was migrated from a local Docker Compose setup to a highly available, auto-scaling production environment in **us-west-2**.

### 1. Infrastructure (AWS)
- **EKS Cluster**: Named `blog-cluster`, running Kubernetes v1.31 with 2 `t3.small` managed nodes.
- **RDS MySQL**: A managed database instance (`blog-mysql`) running MySQL 8.0.40. It is hosted within the EKS VPC to ensure secure, low-latency connectivity for the microservices.
- **ECR Repository**: A single repository `blog-platform` hosting 4 distinct images distinguished by tags:
  - `auth-service`
  - `post-service`
  - `comment-service`
  - `frontend`
- **Route 53**: Hosted zone for `saicloudlabs.store` with a CNAME record for the subdomain `blog.saicloudlabs.store`.

### 2. Kubernetes Components
- **Namespaces**:
  - `blog`: Main application namespace.
  - `cert-manager`: Handles SSL/TLS automation.
  - `ingress-nginx`: Manages external traffic routing.
- **Ingress Controller**: Nginx Ingress Controller (AWS NLB backed) providing path-based routing:
  - `/api/auth` -> Auth Service
  - `/api/posts` -> Post Service
  - `/api/comments` -> Comment Service
  - `/` -> Frontend (Nginx static serving)
- **SSL/TLS**: Automated via Let's Encrypt using `cert-manager` and a `ClusterIssuer`.
- **Auto-scaling**: Horizontal Pod Autoscalers (HPA) configured for backend services to scale between 2 and 5 replicas based on CPU utilization.

---

## 🛡️ Troubleshooting Guide

### 1. SSL/Certificate Issues
When SSL is not turning "Ready", check the resources in this specific hierarchy:

#### **Step A: Check Certificate Status**
```bash
kubectl get certificate -n blog
kubectl describe certificate blog-tls -n blog
```
*Look for: "Ready: True". If False, check the "Events" at the bottom.*

#### **Step B: Check Certificate Request**
```bash
kubectl get certificaterequest -n blog
kubectl describe certificaterequest <request-name> -n blog
```

#### **Step C: Check Challenges (The "Proof")**
Cert-manager creates a temporary "Challenge" resource to prove you own the domain.
```bash
kubectl get challenges -n blog
kubectl describe challenge <challenge-name> -n blog
```
*Common Error: "Waiting for HTTP-01 challenge propagation". This usually means DNS has not yet reached the cluster's internal network.*

---

### 2. DNS & Networking Issues

#### **Verify DNS Propagation**
To check if the world can see your domain:
```bash
# Ask Google DNS
nslookup blog.saicloudlabs.store 8.8.8.8

# Ask AWS Nameservers directly
nslookup blog.saicloudlabs.store ns-1139.awsdns-14.org
```

#### **Test Load Balancer Connectivity**
Since the Ingress expects a "Host" header, browsing the raw AWS ELB URL often results in a 404. Test it via CLI instead:
```bash
curl.exe -v -H "Host: blog.saicloudlabs.store" http://<your-load-balancer-url>
```

---

### 3. Database Connectivity
If pods are crashing with `P1001: Can't reach database server`:
1. **VPC Check**: Ensure RDS and EKS are in the same VPC.
2. **Security Groups**: Ensure the RDS Security Group allows inbound traffic on port 3306 from the EKS Node Security Group.
3. **Secrets**: Verify the `DATABASE_URL` in the Kubernetes Secret is updated with the current RDS endpoint.

---

## 🛠️ Common Operations Cheatsheet

| Task | Command |
| :--- | :--- |
| **Check All Pods** | `kubectl get pods -n blog` |
| **View Service Logs** | `kubectl logs deployment/auth-service -n blog` |
| **Restart a Service** | `kubectl rollout restart deployment <service-name> -n blog` |
| **Check Ingress IP** | `kubectl get ingress -n blog` |
| **Check HPA Status** | `kubectl get hpa -n blog` |

---

## 🌐 Live Environment
- **Domain**: [https://blog.saicloudlabs.store](https://blog.saicloudlabs.store)
- **Region**: us-west-2
- **Namespace**: blog