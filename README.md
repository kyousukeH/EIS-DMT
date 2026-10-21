# EIS-DMT

EIS-DMT 虚拟机迁移控制台，底层对接 Forklift v2.12。控制台通过服务端访问集群 API，浏览器不会获得 ServiceAccount Token。

## 已实现能力

- Provider、NetworkMap、StorageMap、Plan 和 Migration 的查看与核心操作。
- 可创建远端 KubeVirt 源环境，并与内置 EIS 目标集群明确区分。
- 网络和存储资源可从 Inventory 清单直接选择，并显示正在使用该资源的虚拟机。
- 虚拟机列表展示配置磁盘总容量，不使用易产生单位歧义的实际占用量。
- 概览提供“连接源环境、设置资源去向、选择虚拟机迁移”的三步操作引导。
- 六步 Plan 向导：Provider、VM、Concern、映射、迁移选项、提交检查。
- `skipGuestConversion` 和 `runPreflightInspection` 显式配置及风险提示。
- StorageMap 为每一条映射显式写入可配置的 `volumeMode` 和 `accessMode`。
- `ForkliftController.spec.feature_validation` 全局开关，关闭时要求二次文字确认。
- 从 Plan VM pipeline 展示 CDI 磁盘复制总进度、逐磁盘进度、失败阶段和原始原因。
- Migration 启动、取消、warm cutover、重试及 `resumeConversion`。
- Basic Auth、最小化 RBAC、只读根文件系统和离线镜像包。

## 本地运行

```sh
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。本地开发默认连接集群 API，需要提供可用的访问凭据和网络连接。

质量检查：

```sh
npm run check
```

## 集群配置

部署参数位于 `deploy/k8s/configmap.yaml`：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `FORKLIFT_NAMESPACE` | `konveyor-forklift` | Forklift CR 所在 Namespace |
| `INVENTORY_API_URL` | `https://forklift-inventory...:8443` | Inventory Service 地址 |
| `DEFAULT_STORAGE_CLASS` | `ocs-storagecluster-ceph-rbd` | 新 StorageMap 的默认 StorageClass |
| `DEFAULT_VOLUME_MODE` | `Block` | 默认卷模式 |
| `DEFAULT_ACCESS_MODE` | `ReadWriteMany` | 默认访问模式，可在创建或编辑映射时调整 |

如果 Inventory Service 或 TLS Secret 名称不同，需要同步修改 ConfigMap 和 Deployment。可先执行：

```sh
kubectl get forkliftcontrollers -A
kubectl get service,secret -n konveyor-forklift | grep forklift-inventory
```

## 联网环境构建离线包

参数必须是离线集群能够访问的内部镜像仓库地址：

```sh
./scripts/build-offline-bundle.sh \
  registry.example.internal/migration/forklift-migration-console:v0.1.0
```

如 Forklift 使用其他 Namespace：

```sh
FORKLIFT_NAMESPACE=openshift-mtv ./scripts/build-offline-bundle.sh \
  registry.example.internal/migration/forklift-migration-console:v0.1.0
```

生成文件为 `artifacts/forklift-migration-console-offline.tar.gz`，包含容器镜像、校验和、Kustomize 清单和安装脚本。
如果镜像已提前构建并加载到本机，可在断网环境中设置 `SKIP_IMAGE_BUILD=true`，直接从本地镜像生成安装包。

## 离线集群安装

在能够访问内部镜像仓库和 Kubernetes API 的管理机上：

```sh
tar -xzf forklift-migration-console-offline.tar.gz
cd forklift-migration-console-offline
export CONSOLE_PASSWORD='replace-with-a-strong-password'
./install.sh
```

安装脚本会校验镜像包、载入镜像、推送到内部仓库、创建认证 Secret、部署并等待 Pod Ready。若集群节点直接预加载镜像且没有内部仓库，需要把 Deployment 改为节点已有的镜像名并保持 `imagePullPolicy: IfNotPresent`。

为每个迁移目标 Namespace 授权：

```sh
./scripts/authorize-target-namespace.sh vm-workloads konveyor-forklift
```

临时访问：

```sh
kubectl -n konveyor-forklift port-forward service/forklift-migration-console 8080:8080
```

浏览器打开 `http://127.0.0.1:8080`，用户名默认为 `admin`，密码为安装时的 `CONSOLE_PASSWORD`。

生产入口可使用 `deploy/k8s/ingress.example.yaml` 或 `route.example.yaml`，必须启用 TLS。当前独立部署使用共享 ServiceAccount 身份，所有控制台用户具有相同集群审计身份；需要逐用户 RBAC 时，应改为 OpenShift Console Plugin 或接入企业 OIDC 后执行用户令牌委派。

## 迁移字段说明

- `skipGuestConversion=false`：执行 virt-v2v，适配 VirtIO 网络和磁盘驱动。包含特殊网络设备的客户镜像通常应保持此值为 `false`。
- `runPreflightInspection=false`：绕过迁移前深度检查，可处理磁盘分区已满等特殊镜像，但复制、转换或首次启动仍可能失败。
- `feature_validation=false`：关闭整个 Forklift 实例的 Validation，不是单 Plan 设置。特殊迁移完成后应立即恢复。
- 磁盘进度来自 `Plan.status.migration.vms[].pipeline[].tasks[].progress`。Forklift Controller 已从 CDI `DataVolume.status.progress` 汇总该数据，不需要控制台直接访问目标集群的 CDI 对象。
