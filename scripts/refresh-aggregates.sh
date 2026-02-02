#!/bin/bash
# Refresh continuous aggregates after backfill completes
#
# Usage: ./scripts/refresh-aggregates.sh

set -e

echo "Refreshing continuous aggregates..."

docker compose exec -T db psql -U polygon -d polygon_dashboard -c "CALL refresh_continuous_aggregate('blocks_1min_agg', NULL, NULL);"
docker compose exec -T db psql -U polygon -d polygon_dashboard -c "CALL refresh_continuous_aggregate('blocks_1hour_agg', NULL, NULL);"

echo "Done."
