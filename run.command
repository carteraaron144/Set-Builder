#!/bin/zsh
# Starts the Set Builder API server and the Vite dev server, then opens the app in Firefox.
# Vite serves the web app on 5173 and passes /api and /packs through to the server on 8080.
# Double-click in Finder, or run ./run.command. Close the window or press Ctrl+C to stop both.

ROOT="${0:A:h}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
API="http://localhost:8080"
URL="http://localhost:5173"
PIDS=()
trap 'kill $PIDS 2>/dev/null' EXIT INT TERM

if curl -sf "$API/api/health" >/dev/null; then
  echo "The API server is already running at $API."
else
  (cd "$ROOT/server" && exec ./gradlew bootRun -PskipWeb) &
  PIDS+=($!)
fi

if curl -sf "$URL" >/dev/null; then
  echo "Vite is already running at $URL."
else
  cd "$ROOT/web" || exit 1
  [[ -d node_modules ]] || npm install || exit 1
  ./node_modules/.bin/vite --port 5173 --strictPort &
  PIDS+=($!)
fi

echo "Waiting for the servers..."
until curl -sf "$API/api/health" >/dev/null && curl -sf "$URL" >/dev/null; do
  for pid in $PIDS; do
    if ! kill -0 $pid 2>/dev/null; then
      echo "A server stopped before it came up."
      exit 1
    fi
  done
  sleep 1
done

open -a Firefox "$URL"
(( ${#PIDS} )) && wait $PIDS
