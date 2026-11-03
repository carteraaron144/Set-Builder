# Sets saved on the server (Postgres + REST)

Goal: sets are saved to and loaded from Postgres through REST endpoints, owned by an anonymous user identified by a
cookie. The server replaces browser storage. The owner model is the skeleton that real accounts attach to later.

## Database

- Local Homebrew Postgres 18 (already running). Databases `setbuilder` (dev) and `setbuilder_test` (tests), created
  with `createdb`. No Docker needed; README gets the two setup commands.
- Gradle: `spring-boot-starter-data-jpa`, `spring-boot-starter-flyway`, `flyway-database-postgresql`,
  `org.postgresql:postgresql` (runtime), Kotlin `plugin.jpa` (no-arg constructors for entities).
- `application.yml`: datasource from `SETBUILDER_DB_URL` / `_USER` / `_PASSWORD` with local defaults;
  `ddl-auto: validate` (Flyway owns the schema); multipart limit 64 MB.
- Flyway `V1__users_and_sets.sql`:
  - `users (id uuid pk, created_at timestamptz)`. Later accounts add columns (email, password hash) here.
  - `sets (id uuid pk, owner_id uuid fk users not null, name text, size int (64/128/256), updated_at timestamptz, file bytea)`,
    index on `(owner_id, updated_at desc)`.
- `file` is the existing `.setbuilder` zip from `writeSceneFile`, stored as-is. The server never parses it.

## Server (`app.setbuilder.users`, `app.setbuilder.sets`)

- `UserEntity`, `UserRepository`.
- `CurrentUser` resolver: reads the `sb_owner` cookie (UUID). If it is missing, malformed or unknown, it creates a user
  and sets the cookie (HttpOnly, SameSite=Lax, Path=/api, one year). Controllers take a `CurrentUser` argument and never
  touch cookies. When accounts arrive, only this resolver changes.
- `SetEntity`, `SetRepository` (`findByOwnerIdOrderByUpdatedAtDesc` returning a summary projection without the
  file bytes, `findByIdAndOwnerId`).
- `SetController` under `/api/sets`:
  - `GET /api/sets` lists `[{id, name, size, updatedAt}]`, newest first.
  - `GET /api/sets/{id}` returns the zip (`application/octet-stream`).
  - `PUT /api/sets/{id}` takes multipart `meta` (JSON `{name, size}`) and `file`; creates or replaces the set and sets
    `updatedAt` on the server.
  - `DELETE /api/sets/{id}` returns 204.
  - A set owned by someone else is a 404 on every route, and PUT never overwrites it.
  - Validation: name 1–200 chars, positive size, non-empty file; otherwise 400.

## Web

- `persistence/httpSceneStore.ts`: `HttpSceneStore` implements the existing `SceneStore` interface with `fetch`
  (`credentials: 'same-origin'`). `load` runs the bytes through `readSceneFile`; a 404 means `undefined`.
- `ServerUnavailableError` replaces `StorageUnavailableError` for network failures and 5xx responses, with a
  user-facing message. 4xx responses throw with the server's message.
- `editor/browserDeps.ts` opens `HttpSceneStore` instead of `openSceneStore`.
- One-time import: on start, if browser storage still holds sets, upload each one with PUT, then delete the IndexedDB
  database. If an upload fails, browser storage is kept so the import retries next start.
  `sceneStore.ts` stays only for this import.

## Tests (test-first)

- Server, against `setbuilder_test` (cleaned between tests):
  - Repository: the list is newest-first, scoped to the owner, and excludes file bytes.
  - `CurrentUser`: a missing, malformed or unknown cookie creates a user and sets the cookie; a valid cookie reuses
    the user.
  - Controller (MockMvc): PUT then GET round-trips the bytes; the list order; DELETE; another owner gets 404 on
    GET/PUT/DELETE and their set is unchanged; 400 for a bad name, size or empty file; an oversize upload is rejected.
- Web (Vitest, mocked `fetch`): the store's request shapes and status mapping; 404 maps to `undefined`; network
  failure maps to `ServerUnavailableError`; the import uploads every set, clears browser storage only after all
  succeed, and keeps it on failure.

## Out of scope

Real accounts and login, sharing, offline fallback, conflict detection between two tabs (last write wins), and storing
blobs outside Postgres.

## Manual checks

Save, reload and reopen a large set in the browser; the cookie survives a browser restart; the import moves existing
browser sets over once.
