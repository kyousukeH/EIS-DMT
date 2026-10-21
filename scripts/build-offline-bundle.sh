#!/bin/sh
set -eu

IMAGE_REF=${1:-registry.example.internal/migration/forklift-migration-console:v0.1.0}
BUNDLE_NAME=${2:-forklift-migration-console-offline}
FORKLIFT_NS=${FORKLIFT_NAMESPACE:-konveyor-forklift}
IMAGE_NAME=${IMAGE_REF%:*}
IMAGE_TAG=${IMAGE_REF##*:}
ROOT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT_DIR="$ROOT_DIR/artifacts/$BUNDLE_NAME"

if [ "$IMAGE_NAME" = "$IMAGE_TAG" ]; then
  echo "IMAGE_REF must include an explicit tag" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR/deploy"
if [ "${SKIP_IMAGE_BUILD:-false}" = "true" ]; then
  docker image inspect "$IMAGE_REF" >/dev/null
else
  docker build --platform linux/amd64 -t "$IMAGE_REF" "$ROOT_DIR"
fi
docker save "$IMAGE_REF" | gzip -9 > "$OUTPUT_DIR/forklift-migration-console-image.tar.gz"
cp -R "$ROOT_DIR/deploy/k8s/." "$OUTPUT_DIR/deploy/"
cp "$ROOT_DIR/scripts/install-offline.sh" "$OUTPUT_DIR/install.sh"
chmod +x "$OUTPUT_DIR/install.sh"

sed -i "s#newName: .*#newName: $IMAGE_NAME#" "$OUTPUT_DIR/deploy/kustomization.yaml"
sed -i "s#newTag: .*#newTag: $IMAGE_TAG#" "$OUTPUT_DIR/deploy/kustomization.yaml"
sed -i "s#namespace: konveyor-forklift#namespace: $FORKLIFT_NS#g" \
  "$OUTPUT_DIR/deploy/kustomization.yaml" \
  "$OUTPUT_DIR/deploy/auth-secret.example.yaml" \
  "$OUTPUT_DIR/deploy/rbac.yaml"
sed -i "s#FORKLIFT_NAMESPACE: konveyor-forklift#FORKLIFT_NAMESPACE: $FORKLIFT_NS#" "$OUTPUT_DIR/deploy/configmap.yaml"
sed -i "s#forklift-inventory.konveyor-forklift.svc#forklift-inventory.$FORKLIFT_NS.svc#" "$OUTPUT_DIR/deploy/configmap.yaml"
printf '%s\n' "$IMAGE_REF" > "$OUTPUT_DIR/IMAGE_REF"
printf '%s\n' "$FORKLIFT_NS" > "$OUTPUT_DIR/FORKLIFT_NAMESPACE"
(cd "$OUTPUT_DIR" && sha256sum forklift-migration-console-image.tar.gz > SHA256SUMS)
(cd "$ROOT_DIR/artifacts" && tar -czf "$BUNDLE_NAME.tar.gz" "$BUNDLE_NAME")

echo "Offline bundle: $ROOT_DIR/artifacts/$BUNDLE_NAME.tar.gz"
