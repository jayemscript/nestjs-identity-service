# Dependencies and Compatibility

Release classification: first-release prerequisite, M0. Last reviewed: 2026-10-27.

[Documentation index](../README.md) · Next: [Common infrastructure](../02-common-infrastructure/README.md)

## Objective and scope

Define the smallest compatible dependency baseline for the planned service. Session 1 pinned the runtime and package manager, converted the shell and tests to ESM, and removed direct packages with no scaffold use. Session 2 installed matched Better Auth schema-inspection packages and added a database persistence baseline. No native authentication handler or SMTP transport is operational yet.

## Architecture and design

### Pre-implementation baseline and Session 1 changes

The original manifest specified ranges; the original lockfile resolved the following relevant versions. These are historical observations, not a post-change compatibility result. An installed package is not proof that the application starts.

| Package | Manifest | Observed resolved version | Treatment |
| --- | --- | --- | --- |
| Nest common/core/platform-express | `^11.0.1` | 11.2.7 | Retain Nest 11 and Express adapter |
| Express via platform-express | Transitive | 5.2.1 | Use Express 5 named wildcard routing |
| `@nestjs/config` | `^4.0.4` | 4.0.4 | Reuse configuration boundary |
| `@nestjs/typeorm` | `^11.0.1` | 11.0.3 | Reuse database integration |
| `typeorm` | `^1.0.0` | 1.1.2 | Retain initially; verify migration/API compatibility later |
| `pg` | `^8.21.0` | 8.23.1 | Reuse for supported Better Auth connection |
| `redis` | `^6.0.0` | 6.3.0 | Removed as an unused direct dependency in Session 1; not required for release-one auth storage |
| TypeScript | `^5.7.3` | 5.9.3 | Retain NodeNext and validate tooling conversion |
| `uuid` | `^14.0.0` | 14.0.3 | Reuse UUIDv7 for custom entities |
| Better Auth | Absent | Absent | Future direct dependency |
| Nodemailer | Absent | Absent | Future SMTP-only transport dependency |

Session 1 reuses configuration, Swagger, validation, TypeORM, and test packages. An import audit found no scaffold use of `@nestjs/jwt`, bcrypt, argon2, SimpleWebAuthn, Redis, throttler, or scheduling, so their direct dependencies were removed. Add a package in its owning session when implementation needs it; plugin-transitive dependencies remain owned by the plugin. The manifest now declares ESM, Node `>=24.22.1 <25`, and pnpm 11.25.0, with `.node-version` pinning the exact local target.

### Session 2 additions and later candidates

| Package | Baseline researched | Purpose and boundary |
| --- | --- | --- |
| `better-auth` | 1.7.12 installed | Core plus bundled username, admin, two-factor, magic-link, email-OTP, bearer, and one-time-token plugins; schema inspection only so far |
| `@thallesp/nestjs-better-auth` | 2.8.0 | Selected Nest integration: `AuthModule.forRootAsync`, `AuthService`, native handler middleware, and Nest authentication guard; no second manual handler |
| `@better-auth/passkey` | 1.7.12 installed | Native passkey schema |
| `@better-auth/sso` | 1.7.12 installed | Inbound OIDC and SAML schema |
| `@better-auth/api-key` | 1.7.12 installed | Service credential schema; sessions from keys disabled in inspection config |
| `nodemailer` | 10.1.1 | SMTP transport only |
| `@types/nodemailer` | Matching compatible type declarations if required | Development typing only |
| `@nestjs/terminus` | Nest 11-compatible release, pin before installation | Liveness/readiness composition |
| `helmet` | Express 5/Node 24-compatible release, pin before installation | Security headers at the HTTP boundary |
| `auth` CLI | 1.7.12 installed as a development dependency | Native SQL inspection only; not a deployment migration runner |

Versions above are research observations, not a promise of future availability or permission to use floating `latest`. Before future installation, record exact versions, peer requirements, package integrity, relevant advisories, and license/deployment constraints. Pin the reviewed result in the manifest/lockfile. Do not replace the chosen persistence path with a community adapter as an installation workaround.

### Compatibility evidence

- Published and installed `@nestjs/typeorm` 11.0.3 metadata permits Nest 10/11 and TypeORM `^0.3.0 || ^1.0.0-dev`. The existing stable TypeORM 1.1.2 resolution must be checked with the package manager's semver interpretation and actual APIs during implementation; do not declare it broken merely because it is 1.x.
- TypeORM 1.1.2 declares Node `^20.19.0 || ^22.13.0 || >=24.11.0`; the selected Nest bridge 2.8.0 requires Node `>=22.22.1`. Node **24.22.1 LTS** satisfies both and is the [October 21 security release](https://nodejs.org/en/blog/release/v24.22.1/). The old Node 22 recommendation is superseded. Local verification must use 24.22.1 or report the version gap.
- The [tagged bridge 2.8.0 manifest](https://github.com/ThallesP/nestjs-better-auth/blob/v2.8.0/package.json) declares ESM-only exports and peers for Nest `^11.1.6 || ^12.0.0`, TypeScript `^5.9.2 || ^6.0.0`, and Better Auth `>=1.5.0 <2.0.0`; Express 5 is an optional peer. The [tagged source](https://github.com/ThallesP/nestjs-better-auth/blob/v2.8.0/src/auth-module.ts) implements `AuthModule.forRootAsync`, while the [Better Auth Nest guide](https://better-auth.com/docs/integrations/nestjs) shows the simpler `forRoot` path and requires `bodyParser: false`. Native runtime compatibility remains unverified until its owning session.
- Better Auth 1.7.8 was the earlier research candidate. Session 2 pinned core, passkey, SSO, API key, and the `auth` CLI at 1.7.12 in the manifest and lockfile for native schema generation. Better Auth and the future Nest bridge publish ESM. `module: nodenext` alone does not turn `.ts` output into ESM when the package has no `type: module`; Session 1 added that declaration and relative `.js` specifiers.
- Better Auth's PostgreSQL path accepts `pg.Pool`. It does not require a TypeORM adapter. Pools have separate connection budgets and transactions.
- Web and native iOS/Android authentication are first-release requirements. The bundled `bearer` and `oneTimeToken` plugins provide native session transport; no Expo-only integration, OAuth token issuer, mobile client secret, JWT session, or refresh-token pair is required. Primary authentication and enrolled MFA complete in a hosted system browser before the [mobile handoff](../14-mobile-authentication/README.md).
- For the pinned release, configure `bearer({ requireSignature: true })` and `oneTimeToken({ disableClientRequest: true, storeToken: 'hashed', expiresIn: 1, disableSetSessionCookie: false, setOttHeaderOnNewSession: false })`. One-time-token expiry is in minutes. Native generate/verify operations are server API calls behind the gateway, never directly exposed HTTP endpoints. Validate the signed bearer returned by native verification through typed `auth.api.getSession` using the bearer plugin; do not read `auth.session` by token or treat a signature as sufficient authorization.
- Session 1 verified the shell through focused tests and direct startup. Session 2 verified migrations, database connections, persistence stores, lint, a production-code build, compiled migration listing, and compiled startup against local PostgreSQL. The native handler and external-provider behavior remain unverified. Local Node 24.19.0 is below the declared 24.22.1 target.

## Dependencies and prerequisites

The [overview](../00-project-overview/README.md) supplies requirements. Before feature implementation, identify the runtime image digest, package-manager version, PostgreSQL target version, SMTP transport settings, and externally supplied application origins. Use PostgreSQL 18 as the proposed new-deployment baseline unless the actual platform supplies another supported version; validate selected SQL against the real server rather than assuming its version.

Keep package-manager stores and caches outside the repository. Never create `.pnpm-store` inside any repository. Session 2 installed the native schema-inspection packages with an external package store and without enabling unreviewed dependency lifecycle scripts.

## Database design

No new table is needed for dependency management. The chosen package/plugin configuration determines native schema generation in phase 03. Record the Better Auth/plugin version and configuration fingerprint in each future migration's review notes. The database is not allowed to infer its schema from whatever package happens to be deployed.

## API contracts

This phase adds no endpoint. It constrains future contracts: bridge-mounted Express 5 native routes under `/api/auth/*`, ESM runtime exports, and pinned plugin API shapes. Construct the native instance through `AuthModule.forRootAsync`, resolving the asynchronous native adapter/provider first, and consume it through `AuthService`. Do not register another manual `toNodeHandler`. Do not expose a nonexistent HTTP endpoint for a server-only `auth.api` method. Keep versioned native source references with contracts that rely on source-level behavior. Runtime SSO field encryption decorates the supported native PostgreSQL adapter; schema inspection uses the identical enabled plugins/schema/options with an undecorated native pool, as specified in 03, because the CLI cannot infer PostgreSQL SQL generation from an arbitrary runtime adapter factory.

## Security considerations

Do not enable every dependency lifecycle script. Inventory native build requirements, then explicitly permit reviewed scripts in later package-manager configuration. Do not use `--dangerously-allow-all-builds` as the deployment default. Do not put SMTP/database/IdP secrets into install commands, build arguments, images, or example package metadata.

Retain Better Auth's password hashing contract initially; bcrypt and argon2 are not alternative password stores. Never let a library upgrade silently enable a new native auth route outside the route allowlist.

## Implementation plan

1. Session 1: pin Node 24.22.1 and pnpm 11.25.0; update the container tag, ESM package/imports, Jest ESM transforms, and non-fixing Makefile verification commands. Remove unused direct packages after import audit.
2. Session 1: keep the database module dormant; verify the shell through targeted tests, lint, and direct startup. Do not claim compiled production compatibility because no build check is authorized.
3. Session 2 completed: review matched Better Auth/plugin/CLI metadata and lifecycle scripts, pin 1.7.12, and generate the full native schema from that configuration.
4. Session 2 completed the ESM TypeORM CLI/Makefile path and locally verified the compiled-JS migration listing. Running compiled migrations in the deployment environment remains a later operations check.
5. Native-handler session: install the bridge, confirm asynchronous provider initialization, and collect actual middleware/route compatibility evidence before enabling auth endpoints.

## Acceptance criteria

- DEP-01: Exact installed and proposed versions, Node engines, plugin peers, and module format are recorded separately.
- DEP-02: ESM imports, migration tooling, development startup, production startup, and future test tooling have one documented runtime strategy.
- DEP-03: Supported PostgreSQL integration is used without adding a TypeORM authentication adapter.
- DEP-04: No duplicate password, passkey, JWT-session, or email framework is introduced.
- DEP-05: Package installation and the later container build use pinned tooling and reviewed lifecycle scripts, with no repository-local package store.
- DEP-06: Session 1 records tests/lint/direct startup separately from unperformed compiled-build, migration, and native-provider checks.
- DEP-07: The pinned bundled bearer/one-time-token interfaces, signed bearer round-trip, server-only handoff wrappers, and platform-neutral iOS/Android integration are covered by future verification; native credentials share web's underlying session and policy model.
- DEP-08: Bridge 2.8.0 peers and Node >=22.22.1 are met, only one native handler is registered, and future checks cover async provider initialization, middleware order, explicit composite guards, and retained native response contracts.

## Official references

- [Better Auth installation](https://better-auth.com/docs/installation)
- [Selected Nest integration repository](https://github.com/thallesp/nestjs-better-auth)
- [Nest bridge 2.8.0 package metadata](https://registry.npmjs.org/@thallesp%2fnestjs-better-auth/2.8.0)
- [Better Auth Express integration](https://better-auth.com/docs/integrations/express)
- [Better Auth PostgreSQL integration](https://better-auth.com/docs/adapters/postgresql)
- [Better Auth bearer plugin](https://better-auth.com/docs/plugins/bearer)
- [Better Auth one-time-token plugin](https://better-auth.com/docs/plugins/one-time-token)
- [Nest TypeORM integration](https://docs.nestjs.com/data/typeorm)
- [Nest TypeORM 11.0.3 package metadata](https://registry.npmjs.org/@nestjs%2ftypeorm/11.0.3)
- [TypeORM 1.1.2 package metadata](https://registry.npmjs.org/typeorm/1.1.2)
- [Better Auth 1.7.12 package metadata](https://registry.npmjs.org/better-auth/1.7.12)
- [Nodemailer SMTP transport](https://nodemailer.com/smtp)
- [Node.js ESM packages](https://nodejs.org/api/packages.html#type)
- [Node.js 24.22.1 LTS security release](https://nodejs.org/en/blog/release/v24.22.1/)
- [Nest bridge 2.8.0 tagged manifest](https://github.com/ThallesP/nestjs-better-auth/blob/v2.8.0/package.json)
- [Nest bridge 2.8.0 async module source](https://github.com/ThallesP/nestjs-better-auth/blob/v2.8.0/src/auth-module.ts)
