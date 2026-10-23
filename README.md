# NestJS + Better Auth Framework

An authentication and identity backend service designed around **NestJS**, **Better Auth**, **PostgreSQL**, and **TypeORM**.

The service provides a reusable identity layer for internal applications, SaaS products, ERP systems, and multiple applications sharing the same users through **REST APIs / HTTP**.

**Project status:** the first application-shell milestone provides validated runtime configuration, liveness, and shared HTTP conventions. Authentication, database schemas, authorization, and SMTP remain planned work. The capabilities below describe the target service, not implemented features.

Start with the [documentation index and implementation roadmap](docs/README.md).

## Run the current shell

Use Node.js 24.22.1 and pnpm 11.25.0. Copy `.env.example` to `.env`, then install dependencies with a pnpm store outside this repository and run `pnpm start:dev`. `GET /health/live` returns `{ "status": "ok" }` without contacting a database. In non-production environments, `/docs` describes the routes that currently exist.

The Makefile provides `make dev`, `make lint`, `make test`, `make test-e2e`, and `make verify` (`verify` runs lint and both test suites). The current shell does not expose `/health/ready` or `/api/auth/*`; those routes require the persistence and security milestones. The migration recipes return in the persistence milestone.

## Application Platforms

| Platform | Planned support |
| --- | --- |
| Web applications | First release: approved first-party applications using a same-origin backend for frontend (BFF) or reverse proxy, secure cookies, and application-specific access checks. |
| Native mobile applications (iOS and Android) | First release: system-browser authentication through a first-party hosted portal, verified HTTPS app links, a PKCE-bound single-use handoff, secure device storage, and the same MFA and application-access policy as web. |
| Native desktop applications | Future extension: requires desktop-client authentication flows, secure credential storage, approved redirects, and equivalent MFA enforcement. |

Web and native mobile authentication are mandatory first-release capabilities. Mobile uses iOS ASWebAuthenticationSession or Android Custom Tabs to access every supported sign-in method, including enrolled MFA; this plan does not select a mobile framework or implement an application. Mobile apps are public clients and never contain a backend service key. Native desktop authentication remains a future extension. See [mobile authentication](docs/14-mobile-authentication/README.md), [application integration](docs/13-application-and-service-integration/README.md), and [future extensions](docs/17-future-enhancements/README.md).

## Use Cases

| Use case | Planned integration |
| --- | --- |
| Internal applications | Employee and administrative sign-in, account management, roles, and controlled SuperAdmin bootstrap. |
| SaaS products | A reusable identity backend for approved customer-facing applications, with explicit application access. |
| ERP and business systems | Authentication and identity for ERP, CRM, HR, and other business applications; their business modules retain their own domain permissions. |
| Multiple applications with the same users | One shared user identity with separate memberships and permissions for each application. Access to one application does not automatically grant access to another. |
| Monolithic and standalone applications | HTTP integration with the application's identity layer. |
| Microservices | Authenticated backend calls for authoritative session validation and identity-service permission checks. |

The first release uses **one shared identity realm**. Organization-based multi-tenancy, tenant-scoped roles, and fully isolated tenant identities are future capabilities requiring additional design and implementation.

**SSO in the first release** means accepting sign-in from approved enterprise OIDC and SAML identity providers. Shared users do not automatically mean shared browser cookies or seamless sign-in across unrelated domains. Operating an OAuth/OIDC identity provider for independent applications is a future extension.

## Planned First-Release Features

* Email / Username & Password
* Google OAuth
* Two-Factor Authentication (2FA)
* Magic Links
* Email OTP
* Passkeys
* Enterprise Single Sign-On through external OIDC and SAML providers
* Account Management
* Session Management
* Email verification and password recovery
* Application memberships, roles, and permission checks
* SuperAdmin bootstrap through one controlled operator command
* Service-to-service authentication and HTTP session validation
* Web and native iOS/Android authentication with shared identities and application-specific access
* Security events, audit records, rate limiting, and abuse controls

For users who enable MFA, every sign-in method requires the enrolled TOTP or recovery factor, including passwordless, Google, passkey, and enterprise SSO sign-in.

## Architecture Decisions

* Better Auth owns authentication, credentials, native challenges, sessions, and authentication plugin data through its supported PostgreSQL integration.
* **`@thallesp/nestjs-better-auth`** is the selected Nest integration layer for the auth module, session guard, decorators, and dependency-injected hooks. Application access and MFA assurance remain enforced by service policy.
* TypeORM owns service-specific application access, assurance, delivery, and audit persistence.
* PostgreSQL uses dedicated **`auth`**, **`identity`**, and **`audit`** schemas with explicit privileges.
* Email verification, recovery, OTP, magic links, and security notifications use **SMTP through Nodemailer as a transport library only**, with service-owned message content and no provider SDK or email framework.
* Sessions are database-backed opaque sessions with authoritative revocation and application-specific policy checks.
* Web uses secure cookies through first-party BFFs. Native mobile uses a public mobile gateway with server-held backend credentials and signed opaque bearer sessions stored in Keychain/Keystore; both use the same Better Auth session authority.

## Tech Stack

* **NestJS**
* **Better Auth**
* **@thallesp/nestjs-better-auth**
* **PostgreSQL**
* **TypeORM**
* **REST API / HTTP**

## Documentation

The [documentation index](docs/README.md) links all numbered implementation phases, native versus custom responsibilities, API contracts, database ownership, acceptance criteria, and the master roadmap.

* [System design and current repository state](docs/00-project-overview/README.md)
* [Database schemas and persistence](docs/03-database-and-persistence/README.md)
* [SMTP delivery](docs/05-smtp-delivery/README.md)
* [Authorization and SuperAdmin bootstrap](docs/08-authorization-and-bootstrap/README.md)
* [MFA and session assurance](docs/09-multi-factor-authentication/README.md)
* [Enterprise SSO](docs/12-enterprise-sso/README.md)
* [Application and service integration](docs/13-application-and-service-integration/README.md)
* [Web and native mobile authentication](docs/14-mobile-authentication/README.md)
* [Future platform and tenancy extensions](docs/17-future-enhancements/README.md)
