#!/bin/zsh
# Starts Prometheus (http://127.0.0.1:9090) and Grafana (http://127.0.0.1:3000) with the configs in ops/.
# Needs: brew install prometheus grafana, and the Set Builder server running (Actuator on 127.0.0.1:8081).
# Data lives in ops/.data/ (gitignored). Press Ctrl+C to stop both.

ROOT="${0:A:h:h}"
export SETBUILDER_OPS="$ROOT/ops"
DATA="$SETBUILDER_OPS/.data"
mkdir -p "$DATA/prometheus" "$DATA/grafana/logs" "$DATA/grafana/plugins"

for tool in prometheus grafana; do
  command -v $tool >/dev/null || { echo "$tool is not installed: brew install prometheus grafana"; exit 1; }
done

PIDS=()
trap 'kill $PIDS 2>/dev/null' EXIT INT TERM

prometheus \
  --config.file="$SETBUILDER_OPS/prometheus/prometheus.yml" \
  --storage.tsdb.path="$DATA/prometheus" \
  --web.listen-address=127.0.0.1:9090 \
  --log.level=warn &
PIDS+=($!)

GF_PATHS_DATA="$DATA/grafana" \
GF_PATHS_LOGS="$DATA/grafana/logs" \
GF_PATHS_PLUGINS="$DATA/grafana/plugins" \
GF_PATHS_PROVISIONING="$SETBUILDER_OPS/grafana/provisioning" \
GF_LOG_LEVEL=warn \
grafana server \
  --homepath "$(brew --prefix grafana)/share/grafana" \
  --config "$SETBUILDER_OPS/grafana/grafana.ini" &
PIDS+=($!)

echo "Prometheus: http://127.0.0.1:9090/targets"
echo "Grafana:    http://127.0.0.1:3000 (dashboard: Set Builder)"
wait $PIDS
