#!/bin/sh
set -eu

TARGET_NAMESPACE=${1:?Usage: authorize-target-namespace.sh TARGET_NAMESPACE [FORKLIFT_NAMESPACE]}
FORKLIFT_NAMESPACE=${2:-konveyor-forklift}

kubectl -n "$TARGET_NAMESPACE" create role forklift-migration-console-target \
  --verb=get,create --resource=virtualmachines.kubevirt.io \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$TARGET_NAMESPACE" create rolebinding forklift-migration-console-target \
  --role=forklift-migration-console-target \
  --serviceaccount="$FORKLIFT_NAMESPACE:forklift-migration-console" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl auth can-i --as="system:serviceaccount:$FORKLIFT_NAMESPACE:forklift-migration-console" \
  create virtualmachines.kubevirt.io --namespace="$TARGET_NAMESPACE"
