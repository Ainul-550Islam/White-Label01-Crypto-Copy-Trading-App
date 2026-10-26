# Pull an immutable release, migrate, deploy, health-check and restore the previous tag on failure.
# shellcheck shell=bash
set -euo pipefail

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
: "${REGISTRY:?REGISTRY is required}"
: "${IMAGE_TAG:?IMAGE_TAG is required and must be an immutable release tag}"
: "${PREVIOUS_IMAGE_TAG:?PREVIOUS_IMAGE_TAG is required for automatic rollback}"
[[ "$IMAGE_TAG" != latest && "$IMAGE_TAG" != main ]] || { echo "Refusing floating IMAGE_TAG: $IMAGE_TAG" >&2; exit 2; }

rollback() {
  local status=$?
  local rollback_failed=0
  trap - EXIT
  if ((status == 0)); then
    return 0
  fi
  echo "Deployment failed (status ${status}); rolling back to ${PREVIOUS_IMAGE_TAG}." >&2
  if ! IMAGE_TAG="$PREVIOUS_IMAGE_TAG" "${COMPOSE[@]}" pull api worker notification-service trading-engine execution-engine market-data admin-web web; then
    echo "Rollback image pull failed; local previous images will be used if available." >&2
    rollback_failed=1
  fi
  if ! IMAGE_TAG="$PREVIOUS_IMAGE_TAG" "${COMPOSE[@]}" up -d --remove-orphans; then
    echo "Rollback service restoration failed; manual recovery is required." >&2
    rollback_failed=1
  fi
  if ((rollback_failed != 0)); then
    echo "Automatic rollback was incomplete; inspect service state before accepting traffic." >&2
  fi
  exit "$status"
}
trap rollback EXIT

"${COMPOSE[@]}" pull api migrate worker notification-service trading-engine execution-engine market-data admin-web web
"${COMPOSE[@]}" run --rm migrate
"${COMPOSE[@]}" up -d --remove-orphans
for service in api web admin-web; do
  container_id=$("${COMPOSE[@]}" ps -q "$service")
  [[ -n "$container_id" ]] || { echo "$service did not create a container" >&2; exit 1; }
  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id")
    [[ "$health" == healthy ]] && break
    [[ "$health" != unhealthy && "$health" != exited && "$health" != dead && "$health" != missing ]] || { echo "$service health is $health; refusing to accept the deployment" >&2; exit 1; }
    sleep 5
  done
  [[ "$health" == healthy ]] || { echo "$service did not become healthy" >&2; exit 1; }
done
trap - EXIT
echo "Release ${IMAGE_TAG} deployed and health-checked."
