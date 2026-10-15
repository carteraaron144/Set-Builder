#!/bin/zsh
# Starts the Set Builder server and opens it in Firefox once it's up.
# Double-click in Finder, or run ./run.command. Close the window or press Ctrl+C to stop the server.

cd "${0:A:h}/server" || exit 1
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
URL="http://localhost:8080"

if curl -sf "$URL/api/health" >/dev/null; then
  echo "A server is already running at $URL; opening Firefox."
  open -a Firefox "$URL"
  exit 0
fi

./gradlew bootRun &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT INT TERM

echo "Waiting for the server..."
until curl -sf "$URL/api/health" >/dev/null; do
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo "The server stopped before it came up."
    exit 1
  fi
  sleep 1
done

open -a Firefox "$URL"
wait $SERVER_PID
