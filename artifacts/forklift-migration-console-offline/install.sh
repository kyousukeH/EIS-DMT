#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
IMAGE_REF=$(cat "$SCRIPT_DIR/IMAGE_REF")
FORKLIFT_NS=$(cat "$SCRIPT_DIR/FORKLIFT_NAMESPACE")

if [ -z "${CONSOLE_PASSWORD:-}" ]; then
  echo "Set CONSOLE_PASSWORD to a strong password before installing." >&2
  exit 1
fi

cd "$SCRIPT_DIR"
sha256sum -c SHA256SUMS
gzip -dc forklift-migration-console-image.tar.gz | docker load
docker push "$IMAGE_REF"

kubectl get namespace "$FORKLIFT_NS" >/dev/null
kubectl -n "$FORKLIFT_NS" create secret generic forklift-migration-console-auth \
  --from-literal=password="$CONSOLE_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -k "$SCRIPT_DIR/deploy"
kubectl -n "$FORKLIFT_NS" rollout status deployment/forklift-migration-console --timeout=180s
kubectl -n "$FORKLIFT_NS" get pod,service -l app.kubernetes.io/name=forklift-migration-console
