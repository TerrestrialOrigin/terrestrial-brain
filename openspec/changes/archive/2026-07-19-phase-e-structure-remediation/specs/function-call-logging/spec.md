## MODIFIED Requirements

### Requirement: Client IP address is extracted from request headers

The system SHALL extract the client IP address from request headers preferring the trusted hop: for `x-forwarded-for`, the LAST element of the chain (the hop appended by the platform gateway), then `x-real-ip`, then `cf-connecting-ip`. The candidate SHALL be validated against an IPv4/IPv6 shape before storing; a candidate that does not parse as an IP address SHALL be stored as null. If no recognized header is present, `ip_address` SHALL be null. A comment in the extraction code SHALL document which proxy chain is trusted.

#### Scenario: Trusted hop extracted from multi-hop x-forwarded-for

- **WHEN** a request includes the header `x-forwarded-for: 9.9.9.9, 1.2.3.4`
- **THEN** the log entry's `ip_address` is `1.2.3.4` (the last, gateway-appended hop), not the client-controlled first element

#### Scenario: Spoofed garbage is not stored

- **WHEN** a request includes `x-forwarded-for: not-an-ip-address`
- **THEN** the log entry's `ip_address` is null

#### Scenario: IP extracted from x-real-ip fallback

- **WHEN** a request has no `x-forwarded-for` but has `x-real-ip: 1.2.3.4`
- **THEN** the log entry's `ip_address` is `1.2.3.4`

#### Scenario: No IP headers present

- **WHEN** a request has none of the recognized IP headers
- **THEN** the log entry's `ip_address` is null
