# Forklift 迁移控制台 · 前端设计说明书

> 场景：VMware vSphere 等虚拟化平台 → KubeVirt 集群（基于 kubev2v/forklift）
> 交付物：`console/` 下可交互高保真原型（纯前端，双击 `index.html` 或本地静态服务即可打开）

---

## 1. 设计理念

以运维人员一次真实迁移的心智模型为主线：**接入 → 映射 → 圈选 → 预热 → 割接 → 验证**。

三条设计原则：

1. **流程化优先**：迁移是低频高危操作，用 6 步向导把 `Provider/NetworkMap/StorageMap/Plan/Migration` 这些 CR 概念翻译成业务语言，运维不需要理解 YAML 就能完成一次迁移。
2. **温迁移语义贯穿始终**：整个控制台围绕「预热不中断业务、切换窗口分钟级停机」组织状态与操作——预热进度、待切换、切换窗口停机预估是第一等公民。
3. **深色玻璃拟态视觉**：7×24 值班场景友好；深空底 + 青→靛渐变 + 微光晕营造"基础设施驾驶舱"质感；等宽数字（tabular-nums）保证监控数据不跳动。

## 2. 信息架构

```
迁移控制台
├── 总览 Dashboard      KPI、迁移准备引导（5 步清单式指引）、迁移动态、活跃迁移
├── 新建迁移（向导）★    6 步：平台 → 网络映射 → 存储映射 → 选 VM → 设置 → 预检启动
├── 迁移计划             计划卡片墙（状态/进度/剩余时间）→ 计划详情监控
│    └── 计划详情       VM 阶段管道、实时速率、切换操作、VM 抽屉、事件
├── 平台连接 Providers   源平台/目标集群卡片、连接测试、凭据指纹、接入弹窗
├── 映射配置             网络/存储映射库（可复用，与计划解耦）
├── 迁移历史             成功率、切换窗口统计、批次报告导出
└── 系统设置             并发度、VDDK 镜像、迁移网络、通知与审计
```

### 总览 = 迁移准备引导（Onboarding Checklist）

总览页的角色不是"态势大屏"，而是**引导台**：用一份清单式 stepper 告诉运维"为什么、还差什么、去哪做"。

```
① 接入源平台    —— 读取虚拟机清单/磁盘/快照的数据基础      → #/providers
② 添加目标集群  —— 虚拟机以 VM CR 迁入的 KubeVirt 集群     → #/providers
③ 创建网络映射  —— 源端口组 → pod/Multus NAD，迁后网络一致  → #/mappings
④ 创建存储映射  —— datastore → StorageClass，磁盘变 PVC    → #/mappings
⑤ 启动首个迁移计划 —— 圈选 VM，先预热后分钟级割接          → #/wizard
```

每步含：状态徽章（已完成 ✓ / 下一步 / 待完成）、一句"为什么需要"的说明、资源摘要 tag、去向按钮（已完成为 ghost「查看」，待办为渐变「去创建」）；顶部就绪度 n/5 + 进度条；全部完成时显示"环境已就绪"绿色横幅并引导分批迁移顺序。步骤完成状态由真实资源数据推导（Provider/映射/计划数量）。

## 3. 核心流程：迁移向导（6 步）

| 步骤 | 用户做什么 | 对应 forklift 概念 |
|---|---|---|
| 1 选择平台 | 卡片点选源（vSphere/RHV/OpenStack/Hyper-V/Nutanix/Azure/EC2/OVA）与目标 KubeVirt 集群 | `Provider.spec.type/url/secret` |
| 2 网络映射 | 源端口组 → pod 网络 / Multus NAD / 忽略；每对可选保留静态 IP 或 DHCP | `NetworkMap.spec.map`（`DestinationNetwork.type: pod/multus/ignored`，`networkIPMode: preserve/dhcp`） |
| 3 存储映射 | datastore → StorageClass，展示容量水位与剩余空间校验 | `StorageMap.spec.map` |
| 4 选择虚拟机 | 表格勾选、搜索/集群筛选、快照与共享磁盘风险标记、吸底汇总条（台数/容量/预估预热耗时） | `Plan.spec.vms[]` |
| 5 迁移设置 | 目标命名空间、温/冷迁移、切换窗口（cutover）、实例类型策略、Hook | `Plan.spec.type/cutover/transferNetwork/hook`、`Migration.spec.cutover` |
| 6 预检执行 | 6 项就绪检查动画（凭据/可达性/映射完整性/容量/VDDK/转换器调度）→ 启动 | Controller Conditions + `Migration` 创建 |

体验细节：
- 未映射时点「下一步」自动触发**智能映射**（VLAN → NAD 规则匹配）并 toast 提示，可回退调整；
- 已完成步骤可直接点击回跳修改，步骤条显示渐变连接线；
- 预检全绿后「启动迁移预热」点亮，创建计划并直接跳入监控详情页。

## 4. 迁移监控：状态模型

每台 VM 的阶段管道（对齐 forklift 实际执行时序）：

```
排队 → 预拷贝(Staging 增量轮次) → 待切换 → 停机切换 → virt-v2v 转换 → 启动验证 → 运行中
                                                    ↘ 失败 / 已取消
```

- 计划级状态：`草稿 / 排队 / 预热中 / 待切换 / 切换中 / 已完成 / 有失败`
- 计划详情页：总进度环 + 实时速率 + 预估剩余（按盘容量与速率估算）+ 逐台管道 + 单台抽屉（磁盘级进度、规格转换表、时间线）
- **切换（cutover）交互**：预热完成 → 顶部琥珀色提示条 + 「执行切换」按钮 → 弹窗二次确认（停机预估、时间窗、pre-cutover Hook 勾选）→ 逐台割接动画
- 支持取消单台 VM（保留 PVC 可恢复）与取消整个计划（源端不受影响）

## 5. 设计系统

- **色彩**：底 `#06090f→#0d1524`；主强调青→靛渐变 `#22d3ee→#7c8cf8`；状态色 成功`#34d399` 警告`#fbbf24` 切换`#fb923c` 失败`#fb7185`
- **质感**：玻璃拟态卡片（半透明渐变 + 1px 描边 + backdrop-blur）、背景径向光晕 + 网格纹理、渐变按钮悬浮光斑、进度条流光 shimmer
- **字体**：Inter/系统中文 + JetBrains Mono（数字、IP、速率一律等宽）
- **动效**：页面/步骤切换 fadeInUp、预检逐项落点、状态点脉冲、环形进度平滑过渡；全局 1.6s tick 模拟数据实时性（右上角可切 1×/8× 演示速度）
- **响应式**：≥1180px 四列 KPI/双栏网格，窄屏自动降列，无横向溢出

## 6. 原型文件与运行

```
console/
├── index.html   布局骨架（侧栏/顶栏/视图容器）
├── styles.css   设计系统（tokens/组件/页面样式）
├── app.js       模拟数据 + 视图渲染 + 路由 + 迁移模拟引擎
└── DESIGN.md    本说明书
```

运行：`python -m http.server 8765 --directory console` 后访问 `http://localhost:8765`（或任意静态服务/直接双击 index.html）。

内置演示数据：vCenter 生产平台（19 台 VM 清单）、RHV/OpenStack 源、2 个 KubeVirt 目标集群、5 个不同状态的计划（预热中/待切换/切换中/已完成/草稿）。

## 7. 落地到生产的技术映射（建议）

| 原型层 | 生产实现建议 |
|---|---|
| 数据源 | 直接对接 forklift API：`apis/forklift.konveyor.io/v1beta1` 下 `providers/networkmaps/storagemaps/plans/migrations/hooks`；清单经 `OvaProviderServer`/inventory 接口获取 |
| 框架 | React 18 + TypeScript + Vite；状态管理 TanStack Query（CR 轮询/WebSocket） |
| 组件库 | 自研设计系统（本原型 tokens 直接迁移）或基于 PatternFly 深度定制主题 |
| 实时性 | Migration/VM Pod 事件 watch + CDI DataVolume 进度聚合；速率来自 populator pod metrics |
| 权限 | K8s RBSS 映射：迁移执行/切换需 `migrations/write`，平台连接需 `secrets/read` |
| 顺序 | P0 向导+计划监控 → P1 映射库/历史报告 → P2 多集群/灰度回滚/配额校验 |

## 8. 后续迭代方向

- 批量切换编排（按依赖拓扑排序）、切换 Runbook checklist
- 迁移后健康验证（ping/agent 探活）与自动回滚预案
- 大规模（500+ VM）圈选的虚拟机树（集群/文件夹展开）与容量模拟器
- 国产化适配：麒麟/统信宿主侧 Agent 健康状态、离线镜像仓库校验
