# Health and metrics: Actuator, Prometheus, Grafana

Goal: the server exposes built-in health and metrics through Spring Boot Actuator, Prometheus collects them, and a
Grafana dashboard kept in the repo shows them. One script starts the monitoring stack locally.

```
Spring server ──/actuator/prometheus──▶ Prometheus (scrapes every 15 s, stores history) ──▶ Grafana (dashboard)
  :8080 app + /api                         :9090                                              :3000
  :8081 actuator (localhost only)
```

## Server

- Gradle: `spring-boot-starter-actuator`, `io.micrometer:micrometer-registry-prometheus`.
- Actuator gets its own port so it never sits on the public app port. There's no auth yet:
  - `management.server.port: 8081`, `management.server.address: 127.0.0.1`
  - `management.endpoints.web.exposure.include: health, info, metrics, prometheus`
  - `management.endpoint.health.show-details: always` (local only), `management.endpoint.health.probes.enabled: true`
    (`/actuator/health/liveness` and `/readiness` for a future deploy)
  - `management.metrics.tags.application: setbuilder`
  - `management.metrics.distribution.percentiles-histogram.http.server.requests: true` (so Grafana can compute p95)
- Health: Actuator's `db` (Postgres) and `diskSpace` checks come for free. Health is `DOWN` when Postgres is
  unreachable.
- `/api/health` and `HealthController` are removed. Nothing in the web app calls them, and Actuator replaces them.
- Built-in metrics come for free: HTTP requests per endpoint, status and latency (`http_server_requests_seconds`), JVM
  memory and GC, Hikari connection pool, Tomcat threads, process uptime and CPU.
- Custom metrics, recorded in `SetService` and `CurrentUserResolver` through an injected `MeterRegistry`:

  | Metric | Type | Tags | When |
  |---|---|---|---|
  | `setbuilder.sets.saved` | counter | `result` = `created` / `replaced` | a PUT succeeds |
  | `setbuilder.sets.rejected` | counter | `reason` = `invalid` / `too-large` / `not-found` | a PUT is refused |
  | `setbuilder.sets.deleted` | counter | | a DELETE succeeds |
  | `setbuilder.set.file.bytes` | distribution summary (with percentiles histogram) | | each saved file's size |
  | `setbuilder.users.new` | counter | | the resolver creates an anonymous user (not `.created`: Prometheus reserves `_created`) |

  No per-user or per-set tags: unbounded tag values would blow up Prometheus.

## Monitoring stack (`ops/`)

- Installed with `brew install prometheus grafana`. Docker Compose isn't available here, and the configs below would
  also work in containers later.
- `ops/prometheus/prometheus.yml`: one scrape job, `setbuilder`, polling `127.0.0.1:8081/actuator/prometheus` every
  15 s.
- `ops/grafana/grafana.ini`: port 3000, anonymous viewer access on localhost, provisioning from `ops/grafana/provisioning`.
- `ops/grafana/provisioning/datasources/prometheus.yml`: the Prometheus datasource, with a fixed uid the dashboard refers to.
- `ops/grafana/provisioning/dashboards/provider.yml` + `ops/grafana/dashboards/set-builder.json`: the dashboard, loaded
  on start. Edits made in the Grafana UI are exported back to this file to keep them.
- `scripts/metrics.sh`: starts Prometheus and Grafana in the foreground with the repo configs, with data in
  `ops/.data/` (gitignored). Ctrl-C stops both. README gets a Monitoring section.

## Dashboard: "Set Builder"

- **Health:** up/down stat (`up{job="setbuilder"}`), uptime.
- **Traffic:** requests per second by endpoint (`uri`), 4xx and 5xx rate, p50/p95 latency by endpoint.
- **Sets:** saves per minute (created vs replaced), rejections by reason, deletes, new users, file size p50/p95.
- **JVM and database:** heap used vs max, GC pause time, live threads, Hikari active/idle/pending connections.

## Tests (test-first)

- `SetService` and `CurrentUserResolver` with a `SimpleMeterRegistry`: each counter moves once per event with the
  right tag. A rejected save never counts as saved. The file-size summary records the byte count.
- `@SpringBootTest` on random ports (`@LocalServerPort`, `@LocalManagementPort`):
  - `/actuator/health` on the management port is `UP` and includes `db`.
  - After a PUT, `/actuator/prometheus` contains `http_server_requests_seconds` and `setbuilder_sets_saved_total`.
  - The app port returns 404 for `/actuator/health`, and the management port returns 404 for `/api/sets`.
  - `/api/health` is gone (404).
- Dashboard check: a JUnit test reads `set-builder.json`, collects every metric name used in panel queries, and checks
  each appears in the `/actuator/prometheus` output after a save. This catches dashboards drifting from metric names.
  JVM and Hikari metrics are included.

## Out of scope

Alerting, tracing, log collection (Loki), auth on Actuator, and running the stack anywhere but locally.

## Manual checks

`scripts/metrics.sh` brings up both tools. Prometheus's Targets page shows `setbuilder` as UP. The Grafana dashboard
fills in after a few saves and loads, and the panels look right.

## Decisions to confirm

- Removing `/api/health` rather than keeping it next to Actuator.
- Homebrew rather than starting Colima and adding Docker Compose.
