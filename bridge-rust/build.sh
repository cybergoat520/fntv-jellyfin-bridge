#!/bin/bash
set -e

cd "$(dirname "$0")"

IMAGE_NAME="fnos-bridge"
TAG="${1:-latest}"

echo "Building ${IMAGE_NAME}:${TAG} ..."
docker build -t "${IMAGE_NAME}:${TAG}" .

echo "Done. Run with:"
echo "  docker run -p 8096:8096 -e FNOS_SERVER=http://your-nas:5666 ${IMAGE_NAME}:${TAG}"
