# Set Builder

A browser-based environment modeling app for game blockouts: a Kotlin + Spring Boot server and a React + Three.js (WebGPU) web app.
Editing, rendering and saving happen in the browser; the server serves the app and asset packs.

## Requirements

- JDK 21: `brew install --cask temurin@21`, or `brew install openjdk@21` and `export JAVA_HOME=/opt/homebrew/opt/openjdk@21`
- Node 26 and npm

## Run the server

`cd server && ./gradlew bootRun` (port 8080). This builds the web app (`npm ci` + `npm run build` in `web/`) and serves it at
http://localhost:8080, with `/api/health`, `/api/asset-packs` and `/packs/<id>/<path>`.

## Development

Run both, then open http://localhost:5173 (Vite proxies `/api` and `/packs` to the server):

- `cd server && ./gradlew bootRun -PskipWeb`
- `cd web && npm run dev`

Add `?renderer=webgl2` to the URL to force the WebGL2 backend (to check the fallback, or work around a WebGPU driver problem).

## Test

- `cd web && npm test`
- `cd server && ./gradlew test` (builds the web app first; add `-PskipWeb` for server-only runs)

## Production build

`cd server && ./gradlew bootJar`, then `java -jar build/libs/setbuilder-0.0.1-SNAPSHOT.jar` from `server/`.

## Asset packs

A pack is a directory `packs/<id>/` with a `pack.json` (`{"name": "...", "version": "..."}`).
The packs directory is `setbuilder.packs-dir` in `server/src/main/resources/application.yml` (default `../packs`, relative to the working directory).
