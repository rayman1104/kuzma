#!/bin/bash
# Build the Parakeet STT CPU image that docker-compose.yml expects.
#
# Why this exists:
#   docker-compose.yml references the image
#     ghcr.io/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai:cpu
#   but that image is NOT published to any registry. `docker compose up parakeet`
#   therefore fails with "error from registry: denied".
#
#   The upstream community project only ships a Dockerfile (no prebuilt image),
#   so we clone it, build the CPU image locally, and tag it with the exact name
#   the compose file expects. After this runs, `docker compose up parakeet -d`
#   just works.
#
# Usage:
#   ./scripts/build-parakeet.sh          # build only if the image is missing
#   ./scripts/build-parakeet.sh --force  # always rebuild
set -euo pipefail

IMAGE="ghcr.io/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai:cpu"
REPO="https://github.com/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai"
# Upstream Dockerfile.cpu pins onnxruntime==1.26.0, which does not exist on PyPI
# (latest is 1.23.x). Pin to a known-good version so the build is reproducible.
ONNXRUNTIME_VERSION="1.23.2"

FORCE="${1:-}"

if [ "$FORCE" != "--force" ] && docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> Image already present: $IMAGE"
  echo "    Run with --force to rebuild. Start it with: docker compose up parakeet -d"
  exit 0
fi

SRC_DIR="$(mktemp -d)"
trap 'rm -rf "$SRC_DIR"' EXIT

echo "==> Cloning $REPO ..."
git clone --depth 1 "$REPO" "$SRC_DIR"

echo "==> Patching onnxruntime pin -> $ONNXRUNTIME_VERSION (upstream pins a nonexistent version) ..."
sed -i -E "s/onnxruntime==[0-9][0-9.]*/onnxruntime==$ONNXRUNTIME_VERSION/" "$SRC_DIR/Dockerfile.cpu"

echo "==> Building $IMAGE (downloads torch + deps, takes several minutes) ..."
docker build -f "$SRC_DIR/Dockerfile.cpu" -t "$IMAGE" "$SRC_DIR"

echo ""
echo "==> Done. Start the service with:"
echo "      docker compose up parakeet -d"
