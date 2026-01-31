# REST vs gRPC for Enterprise Payment APIs

## Executive Summary

This document evaluates REST and gRPC architectures for building a high-throughput, enterprise-grade global payments API. The recommended approach is a **hybrid architecture**: gRPC for internal service communication with a REST gateway for external clients.

---

## 1. Architecture Paradigms

### 1.1 REST (Representational State Transfer)

REST is a **resource-oriented** architecture where APIs are modeled as collections of resources (nouns) manipulated through HTTP methods.

**Design Pattern:**
```
POST   /v1/payments              # Create payment
GET    /v1/payments/{id}         # Retrieve payment
PUT    /v1/payments/{id}         # Update payment
DELETE /v1/payments/{id}         # Cancel payment
POST   /v1/payments/{id}/refund  # Action (verb-as-subresource)
```

**Characteristics:**
- Stateless request/response model
- HTTP semantics (caching, status codes, content negotiation)
- JSON payloads (human-readable)
- URL-based resource identification

### 1.2 gRPC (Google Remote Procedure Call)

gRPC is a **function-oriented** architecture where APIs are modeled as services with callable procedures.

**Design Pattern:**
```protobuf
service PaymentService {
  rpc CreatePayment(CreatePaymentRequest) returns (Payment);
  rpc GetPayment(GetPaymentRequest) returns (Payment);
  rpc RefundPayment(RefundRequest) returns (Refund);
  rpc CapturePayment(CaptureRequest) returns (Payment);
  rpc StreamPaymentUpdates(PaymentQuery) returns (stream PaymentEvent);
}
```

**Characteristics:**
- Strongly-typed contracts (Protocol Buffers)
- Binary serialization (efficient)
- HTTP/2 transport (multiplexing, streaming)
- Bidirectional streaming support

---

## 2. Technical Comparison

### 2.1 Protocol & Serialization

| Aspect | REST | gRPC |
|--------|------|------|
| Transport | HTTP/1.1 or HTTP/2 | HTTP/2 only |
| Serialization | JSON (text) | Protocol Buffers (binary) |
| Payload size | Baseline | 30-50% smaller |
| Serialization speed | ~50-100 MB/s | ~500-1000 MB/s |
| Schema | Optional (OpenAPI) | Required (Protobuf) |
| Human readable | Yes | No (binary) |

### 2.2 Performance Benchmarks

**Single Request Latency (1KB payment payload):**

| Operation | REST/JSON | gRPC/Protobuf |
|-----------|-----------|---------------|
| Serialization | 1.0-2.0 ms | 0.1-0.3 ms |
| Deserialization | 1.0-2.0 ms | 0.1-0.3 ms |
| Network transfer | Baseline | 30-50% faster |
| **Total overhead** | 2-4 ms | 0.2-0.6 ms |

**Multi-Service Chain Latency:**

| Service Chain | REST | gRPC | Improvement |
|---------------|------|------|-------------|
| 1 service | ~5 ms | ~5 ms | Negligible |
| 3 services | ~15 ms | ~8 ms | 47% |
| 5 services | ~25 ms | ~12 ms | 52% |
| 10 services | ~50 ms | ~22 ms | 56% |

**Throughput (single core, synthetic benchmark):**

| Metric | REST | gRPC |
|--------|------|------|
| Requests/second | 10,000-30,000 | 50,000-100,000 |
| CPU utilization | Higher (JSON parsing) | Lower |
| Memory allocation | Higher (string handling) | Lower |

### 2.3 Feature Comparison

| Feature | REST | gRPC |
|---------|------|------|
| Browser support | Native | Requires grpc-web proxy |
| Streaming | WebSocket/SSE (separate) | Native bidirectional |
| Load balancing | L7 standard | Requires gRPC-aware LB |
| Caching | HTTP cache headers | Custom implementation |
| Timeouts/Deadlines | Custom headers | Built-in propagation |
| Cancellation | Not native | Built-in |
| Retries | Custom implementation | Built-in policies |
| Code generation | Optional | Required (multi-language) |
| API exploration | curl, Postman, browsers | grpcurl, specialized tools |
| Debugging | Easy (readable JSON) | Harder (binary format) |

---

## 3. Payment-Specific Considerations

### 3.1 Operation Modeling

Payment systems are inherently **action-oriented** with complex state machines:

```
Authorization → Capture → Settlement → Reconciliation
     ↓
   Void
     ↓
  Refund → Chargeback → Representment
```

**REST Challenge:** Actions must be modeled as resources
```
POST /v1/payments/{id}/actions/capture   # Awkward
POST /v1/payments/{id}/captures          # Better, but verbose
```

**gRPC Advantage:** Direct function mapping
```protobuf
rpc CapturePayment(CaptureRequest) returns (CaptureResponse);
rpc VoidPayment(VoidRequest) returns (VoidResponse);
rpc RefundPayment(RefundRequest) returns (RefundResponse);
```

### 3.2 Real-Time Requirements

| Requirement | REST Solution | gRPC Solution |
|-------------|---------------|---------------|
| Payment status updates | Webhooks or polling | Server streaming |
| Transaction monitoring | WebSocket (separate infra) | Bidirectional streaming |
| Balance updates | Polling | Server streaming |

### 3.3 Compliance & Security

| Aspect | REST | gRPC |
|--------|------|------|
| PCI DSS compliance | Well-documented patterns | Same (TLS required) |
| Audit logging | Standard HTTP logs | Custom interceptors |
| Request validation | Runtime (JSON Schema) | Compile-time (Protobuf) |
| Contract versioning | URL versioning (/v1/, /v2/) | Package versioning |
| Field-level encryption | Custom implementation | Custom implementation |

---

## 4. Architecture Options

### 4.1 Option A: Pure REST

```
┌─────────────────────────────────────────────────────┐
│                    External Clients                  │
└─────────────────────────┬───────────────────────────┘
                          │ REST/JSON
                          ▼
┌─────────────────────────────────────────────────────┐
│                   API Gateway                        │
│            (Rate limiting, Auth, Routing)            │
└─────────────────────────┬───────────────────────────┘
                          │ REST/JSON
                          ▼
┌─────────────────────────────────────────────────────┐
│                  Payment Services                    │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │ Payment │◄─┤  Fraud  │◄─┤ Ledger  │             │
│  │   API   │  │ Service │  │ Service │             │
│  └─────────┘  └─────────┘  └─────────┘             │
└─────────────────────────────────────────────────────┘
```

**Pros:**
- Simplest to implement and maintain
- Universal client compatibility
- Team familiarity
- Excellent tooling and documentation

**Cons:**
- Serialization overhead compounds with service depth
- No native streaming
- Verbose payloads

**Best for:** Monoliths, small teams, <5 services, rapid MVP development

---

### 4.2 Option B: gRPC + grpc-gateway (Recommended)

```
┌─────────────────────────────────────────────────────┐
│                   External Clients                   │
└─────────────────────────┬───────────────────────────┘
                          │ REST/JSON
                          ▼
┌─────────────────────────────────────────────────────┐
│                   grpc-gateway                       │
│              (REST → gRPC translation)               │
└─────────────────────────┬───────────────────────────┘
                          │ gRPC/Protobuf
                          ▼
┌─────────────────────────────────────────────────────┐
│                  Payment Services                    │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │ Payment │◄─┤  Fraud  │◄─┤ Ledger  │             │
│  │   API   │  │ Service │  │ Service │             │
│  └─────────┘  └─────────┘  └─────────┘             │
│         ▲          gRPC/Protobuf                    │
│         └──────────────────────────────────────────►│
└─────────────────────────────────────────────────────┘
```

**Pros:**
- Single Protobuf definition generates both REST and gRPC
- Internal performance benefits (binary serialization)
- Native streaming for internal services
- External REST compatibility maintained
- Auto-generated OpenAPI documentation

**Cons:**
- Additional gateway component
- 1-3ms latency overhead at gateway
- More complex deployment

**Best for:** Microservices architecture, high throughput requirements, teams with gRPC experience

---

### 4.3 Option C: Connect Protocol

```
┌─────────────────────────────────────────────────────┐
│                   External Clients                   │
│         (JSON/HTTP or gRPC - their choice)          │
└─────────────────────────┬───────────────────────────┘
                          │ Connect (JSON or Protobuf)
                          ▼
┌─────────────────────────────────────────────────────┐
│                  Payment Services                    │
│              (Connect handlers - dual protocol)      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │ Payment │◄─┤  Fraud  │◄─┤ Ledger  │             │
│  │   API   │  │ Service │  │ Service │             │
│  └─────────┘  └─────────┘  └─────────┘             │
└─────────────────────────────────────────────────────┘
```

**Pros:**
- No separate gateway needed
- Same handler serves both protocols
- Browser-compatible without proxy
- Modern, actively developed
- Simplest hybrid approach

**Cons:**
- Less control over REST URL design
- Newer ecosystem (less battle-tested than grpc-gateway)
- URLs are method-based (`/PaymentService/CreatePayment`)

**Best for:** New projects, teams wanting gRPC benefits with minimal complexity

---

## 5. Production Maturity Assessment

### 5.1 grpc-gateway

| Indicator | Assessment |
|-----------|------------|
| Age | 9+ years (since 2015) |
| Version | v2 (stable since 2020) |
| GitHub Stars | ~18,000 |
| Production Users | Google Cloud, etcd, CoreOS |
| Maintenance | Active (Google engineers + community) |
| **Verdict** | **Production-ready** |

### 5.2 Connect Protocol

| Indicator | Assessment |
|-----------|------------|
| Age | 3+ years (since 2022) |
| Version | v1 (stable) |
| GitHub Stars | ~3,000 |
| Production Users | buf.build, growing adoption |
| Maintenance | Active (buf.build team) |
| **Verdict** | **Production-ready for new projects** |

---

## 6. Development Effort Comparison

| Factor | Pure REST | gRPC + Gateway | Connect |
|--------|-----------|----------------|---------|
| Initial setup | Low | Medium | Low |
| Schema definition | Optional | Required | Required |
| Code generation | None | Build step | Build step |
| Gateway deployment | None | Required | None |
| Client SDK generation | Manual or OpenAPI | Automatic | Automatic |
| Ongoing maintenance | Low | Medium | Low |
| Team learning curve | None | Medium | Low-Medium |

**Time to First Endpoint:**
- Pure REST: Hours
- gRPC + Gateway: 1-2 days (tooling setup)
- Connect: Hours

---

## 7. Decision Framework

### Choose Pure REST if:
- Building a monolith or <5 services
- Team has no gRPC experience
- Time-to-market is critical
- No streaming requirements
- Expected throughput <10,000 req/s

### Choose gRPC + grpc-gateway if:
- Building 5+ microservices
- Need strict API contracts
- Internal services benefit from streaming
- Want auto-generated, always-in-sync REST API
- Have infrastructure team for gateway management
- Expected throughput >10,000 req/s

### Choose Connect if:
- Starting a new project
- Want gRPC benefits without gateway complexity
- Acceptable to have method-based URLs
- Team is comfortable with newer technology
- Browser clients need direct access

---

## 8. Recommendation

### For Enterprise Global Payments API: gRPC + grpc-gateway

**Rationale:**

1. **Contract-First Development**: Protobuf schemas enforce consistency across services and teams, critical for payment accuracy

2. **Performance at Scale**: Binary serialization provides headroom for growth without re-architecture

3. **External Compatibility**: grpc-gateway provides full REST semantics with custom URL design (`/v1/payments/{id}`) for partner integrations

4. **Streaming for Real-Time**: Native support for payment status streaming, fraud alerts, and balance updates

5. **Production Proven**: Google Cloud, Stripe (internal), Square, and major fintech companies use this pattern

6. **Future-Proof**: Can add gRPC clients directly (mobile apps, internal tools) without backend changes

### Implementation Roadmap

```
Phase 1: Foundation
├── Define Protobuf schemas for core payment operations
├── Set up code generation pipeline
├── Implement core gRPC services
└── Deploy grpc-gateway

Phase 2: Core Features
├── Payment lifecycle (create, capture, void, refund)
├── Idempotency handling
├── Error mapping (gRPC status → HTTP status)
└── OpenAPI documentation generation

Phase 3: Advanced
├── Server streaming for payment webhooks
├── Deadline propagation
├── Circuit breaking
└── Observability (distributed tracing)
```

### Alternative Consideration

If development speed is the primary concern and the team lacks gRPC experience, **start with Pure REST** and migrate internal services to gRPC later. The external REST API can remain stable while internal optimizations are added incrementally.

---

## 9. References

- [gRPC Official Documentation](https://grpc.io/docs/)
- [grpc-gateway GitHub](https://github.com/grpc-ecosystem/grpc-gateway)
- [Connect Protocol](https://connectrpc.com/)
- [Google Cloud API Design Guide](https://cloud.google.com/apis/design)
- [Protocol Buffers Documentation](https://protobuf.dev/)

---

*Document prepared for enterprise payments API architecture evaluation.*
