# Architecture Review

The current microservices layout has 3 main services:
1. Auth gateway
2. Data pipeline
3. Notification service

All communicate via Redis pub/sub.