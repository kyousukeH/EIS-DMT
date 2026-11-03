#!/bin/sh
set -eu

TARGET_NAMESPACE=${1:?Usage: authorize-target-namespace.sh TARGET_NAMESPACE [FORKLIFT_NAMESPACE]}
FORKLIFT_NAMESPACE=${2:-konveyor-forklift}
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

sed \
  -e "s/REPLACE_TARGET_NAMESPACE/$TARGET_NAMESPACE/g" \
  -e "s/REPLACE_FORKLIFT_NAMESPACE/$FORKLIFT_NAMESPACE/g" \
  "$SCRIPT_DIR/../deploy/k8s/target-namespace-rbac.example.yaml" | kubectl apply -f -

kubectl auth can-i --as="system:serviceaccount:$FORKLIFT_NAMESPACE:forklift-migration-console" \
  create virtualmachines.kubevirt.io --namespace="$TARGET_NAMESPACE"
kubectl auth can-i --as="system:serviceaccount:$FORKLIFT_NAMESPACE:forklift-migration-console" \
  delete virtualmachines.kubevirt.io --namespace="$TARGET_NAMESPACE"
kubectl auth can-i --as="system:serviceaccount:$FORKLIFT_NAMESPACE:forklift-migration-console" \
  update virtualmachines.subresources.kubevirt.io --subresource=start --namespace="$TARGET_NAMESPACE"
kubectl auth can-i --as="system:serviceaccount:$FORKLIFT_NAMESPACE:forklift-migration-console" \
  update virtualmachines.subresources.kubevirt.io --subresource=stop --namespace="$TARGET_NAMESPACE"
kubectl auth can-i --as="system:serviceaccount:$FORKLIFT_NAMESPACE:forklift-migration-console" \
  deletecollection persistentvolumeclaims --namespace="$TARGET_NAMESPACE"
kubectl auth can-i --as="system:serviceaccount:$FORKLIFT_NAMESPACE:forklift-migration-console" \
  list persistentvolumeclaims --namespace="$TARGET_NAMESPACE"
