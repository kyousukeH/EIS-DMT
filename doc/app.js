/* ═══════════════════════════════════════════════════════════════
   Forklift 迁移控制台 · 原型逻辑（纯前端模拟，数据结构对齐 CRD）
   Provider / NetworkMap / StorageMap / Plan / Migration / Hook
   ═══════════════════════════════════════════════════════════════ */
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ── 图标库 ─────────────────────────── */
const I = {
  server:'<rect x="2" y="4" width="20" height="7" rx="2"/><rect x="2" y="13" width="20" height="7" rx="2"/><path d="M6 7.5h.01M6 16.5h.01"/>',
  cloud:'<path d="M17.5 19a4.5 4.5 0 0 0 0-9h-1.1A7 7 0 1 0 4 15.9"/>',
  db:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  net:'<rect x="3" y="15" width="18" height="6" rx="2"/><rect x="3" y="3" width="18" height="6" rx="2"/><path d="M12 9v6M8 18h.01M16 18h.01M8 6h.01M16 6h.01"/>',
  vm:'<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  check:'<path d="M4 12.5l5 5L20 6.5"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  play:'<path d="M7 4.5l13 7.5-13 7.5z"/>',
  pause:'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  bolt:'<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  warn:'<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  arrow:'<path d="M4 12h15M13 6l6 6-6 6"/>',
  arrowR:'<path d="M5 12h14M13 6l6 6-6 6" transform="scale(-1,1) translate(-24,0)"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  eye:'<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  stop:'<rect x="5" y="5" width="14" height="14" rx="2.5"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  cutover:'<path d="M16 3h5v5M8 21H3v-5M21 3l-7.5 7.5M3 21l7.5-7.5"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  swap:'<path d="M8 3L4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  chart:'<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-7"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 1.5l1.2 2.9 3.1-.6.5 3.1 2.9 1.2-1.7 2.6 1.7 2.6-2.9 1.2-.5 3.1-3.1-.6L12 22.5l-1.2-2.9-3.1.6-.5-3.1-2.9-1.2 1.7-2.6-1.7-2.6 2.9-1.2.5-3.1 3.1.6z"/>',
  shield:'<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',
  layers:'<path d="M12 2l9 5-9 5-9-5z"/><path d="M3 12l9 5 9-5M3 17l9 5 9-5"/>',
  pin:'<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  cake:'<path d="M4 21h16M4 21v-6M20 21v-6M2 10h20v5H2zM7 10V7M12 10V6M17 10V7"/>',
  lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  wrench:'<path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18v3h3l5.7-5.7a4.5 4.5 0 0 0 6-6l-2.8 2.8-2.2-2.2z"/>',
};
const ic = (n,w) => `<svg viewBox="0 0 24 24" ${w?`style="width:${w}px;height:${w}px"`:''}>${I[n]||I.info}</svg>`;

/* ── 模拟数据（对齐 forklift 资源模型） ─────────────────────────── */
const DATA = {
  providers: [
    { id:'p-vcenter', kind:'source', type:'vsphere', brand:'VM', name:'生产虚拟化平台 · vCenter', url:'vcsa-prod.corp.local', version:'vSphere 8.0.3', status:'ok', vms:186, clusters:4, hosts:22, capTB:96, usedTB:71.3, fingerprint:'fp-8f3a2c' },
    { id:'p-ovirt', kind:'source', type:'ovirt', brand:'OV', name:'历史业务平台 · RHV', url:'rhv-legacy.corp.local', version:'RHV 4.5 SP1', status:'ok', vms:37, clusters:2, hosts:6, capTB:28, usedTB:19.6, fingerprint:'fp-2b9d10' },
    { id:'p-openstack', kind:'source', type:'openstack', brand:'OS', name:'云主机平台 · OpenStack', url:'osp.cloud.corp.local:5000', version:'Zed', status:'warn', warnMsg:'Keystone 令牌将于 3 天后过期', vms:64, clusters:3, hosts:'—', capTB:44, usedTB:26.1, fingerprint:'fp-a4e77c' },
    { id:'p-kubevirt', kind:'target', type:'openshift', brand:'KV', name:'KubeVirt 生产集群', url:'api.cnv-prod.corp.local:6443', version:'KubeVirt v1.4.0 · OCP 4.17', status:'ok', vms:132, clusters:3, hosts:18, capTB:320, usedTB:141.2, fingerprint:'fp-d1c9ff' },
    { id:'p-kubevirt-dr', kind:'target', type:'openshift', brand:'KV', name:'KubeVirt 灾备集群', url:'api.cnv-dr.corp.local:6443', version:'KubeVirt v1.4.0 · OCP 4.16', status:'ok', vms:12, clusters:2, hosts:6, capTB:96, usedTB:30.5, fingerprint:'fp-77e0b1' },
  ],
  netSources: [
    { id:'n1', name:'VM Network', type:'端口组', vlan:'', usedBy:96 },
    { id:'n2', name:'VLAN0010-生产业务', type:'分布式端口组', vlan:'10', usedBy:61 },
    { id:'n3', name:'VLAN0020-管理网', type:'分布式端口组', vlan:'20', usedBy:34 },
    { id:'n4', name:'VLAN0030-备份网', type:'分布式端口组', vlan:'30', usedBy:11 },
    { id:'n5', name:'DPortGroup-存储', type:'分布式端口组', vlan:'40', usedBy:4 },
  ],
  netDests: [
    { id:'pod', name:'pod 网络（默认）', type:'pod', ns:'—' },
    { id:'nad-vlan10', name:'nad-vlan10-prod', type:'multus', ns:'kubevirt-tenant-net' },
    { id:'nad-vlan20', name:'nad-vlan20-mgmt', type:'multus', ns:'kubevirt-mgmt-net' },
    { id:'ignored', name:'忽略此网络', type:'ignored', ns:'—' },
  ],
  storSources: [
    { id:'ds1', name:'ds-nvme-fc01', type:'VMFS 6 · NVMe/FC', capTB:8.2, usedPct:71, usedBy:88 },
    { id:'ds2', name:'ds-ssd-sata02', type:'VMFS 6 · SSD', capTB:12, usedPct:55, usedBy:62 },
    { id:'ds3', name:'ds-nas-archive', type:'NFS v3', capTB:40, usedPct:38, usedBy:36 },
  ],
  storDests: [
    { id:'sc1', name:'ocs-storagecluster-ceph-rbd', prov:'rook-ceph.rbd.csi.ceph.com', reclaim:'Delete', def:true },
    { id:'sc2', name:'local-nvme-lvm', prov:'local.csi.k8s.io', reclaim:'Delete', def:false },
    { id:'sc3', name:'ceph-fs-shared', prov:'rook-ceph.cephfs.csi.ceph.com', reclaim:'Delete', def:false },
  ],
  vmCatalog: [
    { id:'vm-101', name:'web-nginx-01', ip:'10.10.1.11', cluster:'生产-Web', cpu:4, mem:8, disk:120, snap:0, os:'RHEL 8.9', warm:true },
    { id:'vm-102', name:'web-nginx-02', ip:'10.10.1.12', cluster:'生产-Web', cpu:4, mem:8, disk:120, snap:0, os:'RHEL 8.9', warm:true },
    { id:'vm-103', name:'web-nginx-03', ip:'10.10.1.13', cluster:'生产-Web', cpu:4, mem:8, disk:120, snap:2, os:'RHEL 8.9', warm:true, flag:'snapshot' },
    { id:'vm-110', name:'web-haproxy-01', ip:'10.10.1.21', cluster:'生产-Web', cpu:2, mem:4, disk:40, snap:0, os:'RHEL 9.3', warm:true },
    { id:'vm-201', name:'db-mysql-01', ip:'10.10.2.11', cluster:'生产-DB', cpu:8, mem:32, disk:640, snap:1, os:'RHEL 8.9', warm:true },
    { id:'vm-202', name:'db-mysql-02', ip:'10.10.2.12', cluster:'生产-DB', cpu:8, mem:32, disk:640, snap:0, os:'RHEL 8.9', warm:true },
    { id:'vm-203', name:'db-redis-01', ip:'10.10.2.21', cluster:'生产-DB', cpu:4, mem:16, disk:80, snap:0, os:'RHEL 9.3', warm:true },
    { id:'vm-210', name:'db-oracle-fin01', ip:'10.10.2.31', cluster:'生产-DB', cpu:16, mem:64, disk:1450, snap:3, os:'Oracle Linux 8', warm:true, flag:'shared' },
    { id:'vm-301', name:'app-order-01', ip:'10.10.3.11', cluster:'生产-App', cpu:6, mem:16, disk:200, snap:0, os:'RHEL 8.9', warm:true },
    { id:'vm-302', name:'app-order-02', ip:'10.10.3.12', cluster:'生产-App', cpu:6, mem:16, disk:200, snap:0, os:'RHEL 8.9', warm:true },
    { id:'vm-303', name:'app-pay-01', ip:'10.10.3.21', cluster:'生产-App', cpu:6, mem:16, disk:200, snap:0, os:'RHEL 8.9', warm:true },
    { id:'vm-304', name:'app-pay-02', ip:'10.10.3.22', cluster:'生产-App', cpu:6, mem:16, disk:200, snap:0, os:'RHEL 8.9', warm:false, flag:'no-warm' },
    { id:'vm-401', name:'win-2k19-ad01', ip:'10.10.4.11', cluster:'生产-管理', cpu:4, mem:8, disk:100, snap:0, os:'Windows Server 2019', warm:true },
    { id:'vm-402', name:'win-2016-sql01', ip:'10.10.4.21', cluster:'生产-管理', cpu:12, mem:48, disk:860, snap:4, os:'Windows Server 2016', warm:true, flag:'snapshot' },
    { id:'vm-403', name:'win-2k22-rds01', ip:'10.10.4.31', cluster:'生产-管理', cpu:8, mem:24, disk:300, snap:0, os:'Windows Server 2022', warm:true },
    { id:'vm-501', name:'mq-kafka-01', ip:'10.10.5.11', cluster:'生产-中间件', cpu:8, mem:24, disk:400, snap:0, os:'RHEL 9.3', warm:true },
    { id:'vm-502', name:'mq-kafka-02', ip:'10.10.5.12', cluster:'生产-中间件', cpu:8, mem:24, disk:400, snap:0, os:'RHEL 9.3', warm:true },
    { id:'vm-601', name:'mon-grafana-01', ip:'10.10.6.11', cluster:'生产-工具', cpu:2, mem:8, disk:60, snap:0, os:'Ubuntu 22.04', warm:true },
    { id:'vm-602', name:'dev-jenkins-01', ip:'10.10.6.21', cluster:'生产-工具', cpu:8, mem:16, disk:500, snap:6, os:'Ubuntu 22.04', warm:true, flag:'snapshot' },
  ],
  namespaces:['migration-prod','migration-db','tenant-web','tenant-app','migration-win'],
  hooks:[
    { id:'h1', name:'停机前摘除监控探针', play:'ansible/ha-pre.yml', phase:'preCutover' },
    { id:'h2', name:'切换后刷新 DNS 记录', play:'ansible/dns-post.yml', phase:'postCutover' },
  ],
};

/* 阶段定义 */
const PHASES = [
  { k:'queued', lbl:'排队' },
  { k:'staging', lbl:'预拷贝' },
  { k:'readyForCutover', lbl:'待切换' },
  { k:'cutover', lbl:'停机切换' },
  { k:'converting', lbl:'virt-v2v 转换' },
  { k:'starting', lbl:'启动验证' },
  { k:'succeeded', lbl:'已运行' },
];
const PHASE_IDX = Object.fromEntries(PHASES.map((p,i)=>[p.k,i]));

function mkPlanVM(v, phase='queued', progress=0){
  return { ...v, phase, progress,
    disks:(v.disk>=400?[['系统盘',Math.round(v.disk*.25)],['数据盘',v.disk-Math.round(v.disk*.25)]]:[['系统盘',v.disk]]),
    startAt:null, endAt:null };
}

let PLANS = [
  { id:'pl-web', name:'Web 层批次迁移', desc:'生产 Web/HAProxy 批量温迁移',
    src:'p-vcenter', dst:'p-kubevirt', type:'warm', ns:'tenant-web', status:'staging',
    created:'10-18 09:41', instPolicy:'auto', cutoverAt:null,
    vms:[ 'vm-101','vm-102','vm-110','vm-301','vm-302','vm-303','vm-401','vm-403','vm-501','vm-502','vm-601','vm-203' ].map((id,i)=>{
      const v = DATA.vmCatalog.find(x=>x.id===id);
      return mkPlanVM(v, 'staging', i<4?100:Math.max(8, 58 - i*7));
    }),
    throughput:287, startedAt:'10-20 22:00',
  },
  { id:'pl-db', name:'数据库层批次迁移', desc:'MySQL/Redis 温迁移 · 已预热完成',
    src:'p-vcenter', dst:'p-kubevirt', type:'warm', ns:'migration-db', status:'ready',
    created:'10-17 14:05', instPolicy:'preserve', cutoverAt:null,
    vms:[ 'vm-201','vm-202','vm-210' ].map(id=>mkPlanVM(DATA.vmCatalog.find(x=>x.id===id),'readyForCutover',100)),
    throughput:0, startedAt:'10-19 23:00',
  },
  { id:'pl-win', name:'Windows 业务批次', desc:'AD/RDS/SQL Server 域内机器',
    src:'p-vcenter', dst:'p-kubevirt', type:'warm', ns:'migration-win', status:'cutting',
    created:'10-16 10:20', instPolicy:'auto', cutoverAt:'10-21 02:00',
    vms:[
      mkPlanVM(DATA.vmCatalog.find(x=>x.id==='vm-402'),'converting',64),
      mkPlanVM(DATA.vmCatalog.find(x=>x.id==='vm-304'),'starting',90),
    ],
    throughput:96, startedAt:'10-21 02:00',
  },
  { id:'pl-mw', name:'中间件批次迁移', desc:'Kafka 集群整体迁移 · 已完成',
    src:'p-vcenter', dst:'p-kubevirt', type:'warm', ns:'tenant-app', status:'done',
    created:'10-11 16:30', instPolicy:'auto', cutoverAt:'10-13 01:00',
    vms:[
      mkPlanVM({...DATA.vmCatalog.find(x=>x.id==='vm-501')},'succeeded',100),
      mkPlanVM({...DATA.vmCatalog.find(x=>x.id==='vm-502')},'succeeded',100),
    ],
    throughput:0, startedAt:'10-12 23:00',
  },
  { id:'pl-arch', name:'历史平台归档评估', desc:'RHV 旧平台首轮盘点 · 草稿',
    src:'p-ovirt', dst:'p-kubevirt', type:'cold', ns:'migration-prod', status:'draft',
    created:'10-20 11:00', instPolicy:'auto', cutoverAt:null,
    vms:[ mkPlanVM({...DATA.vmCatalog.find(x=>x.id==='vm-602')}) ],
    throughput:0, startedAt:null,
  },
];

const HISTORY = [
  { name:'中间件批次迁移', vms:2, ok:2, fail:0, vol:'0.8 TB', win:'6m12s', end:'10-13 01:12', src:'vSphere' },
  { name:'工具链批次迁移', vms:14, ok:13, fail:1, vol:'3.2 TB', win:'11m48s', end:'10-09 02:03', src:'vSphere' },
  { name:'开发测试批次', vms:46, ok:46, fail:0, vol:'12.4 TB', win:'24m30s', end:'09-28 03:00', src:'vSphere' },
  { name:'OA 系统批次', vms:25, ok:23, fail:2, vol:'5.1 TB', win:'9m55s', end:'09-15 02:20', src:'vSphere' },
];

let EVENTS = [
  { t:'09:12', m:'<b>pl-web</b> 增量同步第 3 轮完成，平均速率 287 MB/s' },
  { t:'08:55', m:'<b>db-oracle-fin01</b> 检测到共享磁盘，已标记为需人工确认' },
  { t:'08:40', m:'<b>pl-db</b> 预热完成，进入待切换状态，建议 22:00 后切换' },
  { t:'07:31', m:'Forklift Controller 2.10.1 升级完成，virt-v2v 镜像同步' },
  { t:'02:03', m:'<b>pl-win</b> 计划切换开始，4 台 VM 进入停机窗口' },
  { t:'01:58', m:'Hook <b>ha-pre.yml</b> 执行成功（2/2 台）' },
];

/* ── 状态 ─────────────────────────── */
const S = {
  route:'dashboard', speed:1, notif:3,
  wizard:{ step:1, src:'p-vcenter', dst:'p-kubevirt', netMap:{}, storMap:{}, sel:new Set(), filter:'', cluster:'全部',
    ns:'tenant-web', type:'warm', cutover:'tomorrow', instPolicy:'auto', hook:'', checked:false, pfDone:false, pfItems:[] },
  plansFilter:'全部',
};

const fmt = n => n.toLocaleString('zh-CN');
const GB = n => n>=1024 ? (n/1024).toFixed(1)+' TB' : n+' GB';
const now = () => new Date().toTimeString().slice(0,5);
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');

/* ── Toast / 弹窗 / 抽屉 ─────────────────────────── */
function toast(type, title, msg){
  const t = document.createElement('div');
  t.className = `toast t-${type}`;
  t.innerHTML = `${ic(type==='ok'?'check':type==='err'?'warn':'info')}<div><b>${title}</b><span style="color:var(--text-1)">${msg||''}</span></div>`;
  $('#toast-root').appendChild(t);
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(),320); }, 4200);
}
function openModal(html){
  const root = $('#modal-root');
  root.innerHTML = `<div class="mask" onclick="closeModal()"></div><div class="modal">${html}</div>`;
}
function closeModal(){ $('#modal-root').innerHTML=''; }
function openDrawer(html){
  const root = $('#drawer-root');
  root.innerHTML = `<div class="mask" onclick="closeDrawer()"></div><div class="drawer">${html}</div>`;
}
function closeDrawer(){ $('#drawer-root').innerHTML=''; }

/* ── 计划计算 ─────────────────────────── */
const planVMsOk = p => p.vms.filter(v=>v.phase==='succeeded').length;
const planProgress = p => {
  if(p.status==='draft') return 0;
  if(p.status==='done') return 100;
  const total = p.vms.reduce((a,v)=>a+v.disk,0)||1;
  const done = p.vms.reduce((a,v)=>a + v.disk * (v.phase==='succeeded'?1:v.progress/100),0);
  return Math.min(99.5, done/total*100);
};
const planStatusMeta = {
  draft:   { lbl:'草稿', cls:'b-idle' },
  queued:  { lbl:'排队中', cls:'b-idle' },
  staging: { lbl:'预热中', cls:'b-run' },
  ready:   { lbl:'待切换', cls:'b-warn' },
  cutting: { lbl:'切换中', cls:'b-cut' },
  done:    { lbl:'已完成', cls:'b-ok' },
  failed:  { lbl:'有失败', cls:'b-err' },
};
const vmStatusMeta = {
  queued: { lbl:'排队', cls:'b-idle' }, staging:{ lbl:'预拷贝中', cls:'b-run' },
  readyForCutover:{ lbl:'待切换', cls:'b-warn' }, cutover:{ lbl:'切换中', cls:'b-cut' },
  converting:{ lbl:'转换中', cls:'b-run' }, starting:{ lbl:'启动中', cls:'b-run' },
  succeeded:{ lbl:'运行中', cls:'b-ok' }, failed:{ lbl:'失败', cls:'b-err' },
  canceled:{ lbl:'已取消', cls:'b-idle' },
};
const estEta = p => {
  const remain = p.vms.reduce((a,v)=>a+v.disk*(1-(v.phase==='succeeded'?1:v.progress/100)),0);
  const rate = Math.max(60, p.throughput||200); // MB/s
  const sec = remain*1024/rate;
  return sec<3600 ? `${Math.round(sec/60)} 分钟` : `${(sec/3600).toFixed(1)} 小时`;
};

/* ═══════════════ 渲染：总览 ═══════════════ */
function renderDashboard(){
  const active = PLANS.filter(p=>['staging','ready','cutting','queued'].includes(p.status));
  const totalDone = HISTORY.reduce((a,h)=>a+h.ok,0) + PLANS.reduce((a,p)=>a+planVMsOk(p),0);
  const okAll = totalDone, failAll = 4;
  const $v = $('[data-view="dashboard"]');
  $v.innerHTML = `
  <div class="view-head">
    <div><h1>迁移总览</h1><p>按引导完成迁移环境准备：接入平台 → 建立映射 → 启动迁移</p></div>
    <div class="actions">
      <div class="mini-legend">
        <span><i style="background:var(--brand-1)"></i>预拷贝</span>
        <span><i style="background:var(--warn)"></i>待切换</span>
        <span><i style="background:var(--cutover)"></i>切换中</span>
        <span><i style="background:var(--ok)"></i>已完成</span>
      </div>
      <button class="btn btn-primary" onclick="go('#/wizard')">${ic('bolt',14)} 新建迁移</button>
    </div>
  </div>

  <div class="kpis">
    ${[
      { l:'已迁移虚拟机', v:fmt(totalDone), u:'台', d:'+128 本月', dc:'up', sp:[8,14,10,18,15,22,19,26,24,30] },
      { l:'进行中计划', v:active.length, u:'个', d:'预热 '+active.filter(p=>p.status==='staging').length+' · 待切换 '+active.filter(p=>p.status==='ready').length, dc:'flat', sp:[3,5,4,6,5,4,3,4,4,4] },
      { l:'累计迁移数据', v:'84.2', u:'TB', d:'+12.4 TB 本月', dc:'up', sp:[10,12,11,15,14,18,16,20,22,25] },
      { l:'迁移成功率', v:(okAll/(okAll+failAll)*100).toFixed(1)+'<small style="font-size:14px">%</small>', u:'', d:'4 台失败已回滚', dc:'flat', sp:[95,96,95,97,96,97,96,96,97,97] },
    ].map(k=>`
    <div class="kpi">
      <div class="label">${k.l}</div>
      <div class="value">${k.v}<small>${k.u}</small></div>
      <div class="delta ${k.dc}">${k.dc==='up'?'▲':k.dc==='down'?'▼':'•'} ${k.d}</div>
      ${spark(k.sp)}
    </div>`).join('')}
  </div>

  <div class="dash-grid">
    ${renderGuide()}
    <div class="dash-right">
      <div class="card" style="flex:1">
        <div class="card-title">${ic('clock')}迁移动态<span class="hint">最近 24h</span></div>
        <div class="event-feed">${EVENTS.slice(0,9).map(e=>`<div class="event"><time>${e.t}</time><div class="msg">${e.m}</div></div>`).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" style="flex:1" onclick="go('#/providers')">${ic('server',12)} 平台连接</button>
          <button class="btn btn-ghost btn-sm" style="flex:1" onclick="go('#/mappings')">${ic('net',12)} 映射配置</button>
          <button class="btn btn-ghost btn-sm" style="flex:1" onclick="go('#/plans')">${ic('play',12)} 迁移计划</button>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">${ic('play')}活跃迁移计划<span class="hint"><a href="#/plans" style="color:var(--brand-1)">查看全部 →</a></span></div>
    ${active.length? `<div class="table-wrap"><table class="table">
      <thead><tr><th>计划</th><th>源 → 目标</th><th>类型</th><th style="width:26%">整体进度</th><th>剩余时间</th><th>状态</th><th>速率</th></tr></thead>
      <tbody>${active.map(p=>`
        <tr class="clickable" onclick="location.hash='#/plan/${p.id}'">
          <td><b>${p.name}</b><br><small style="color:var(--text-2)">${p.vms.length} 台虚拟机</small></td>
          <td><span class="mono" style="font-size:12px">vSphere → KubeVirt</span></td>
          <td>${p.type==='warm'?'温迁移':'冷迁移'}</td>
          <td><div class="progress ${p.status==='done'?'ok':''}"><i style="width:${planProgress(p).toFixed(1)}%"></i></div></td>
          <td class="num">${p.status==='staging'?estEta(p):p.status==='ready'?'待排期':'—'}</td>
          <td><span class="badge ${planStatusMeta[p.status].cls}">${planStatusMeta[p.status].lbl}</span></td>
          <td class="num">${p.throughput?p.throughput+' MB/s':'—'}</td>
        </tr>`).join('')}
      </tbody></table></div>`
    : `<div class="table-empty">${ic('check',38)}当前没有进行中的迁移，点击「新建迁移」开始</div>`}
  </div>`;
}
/* 迁移准备引导（Onboarding checklist） */
function renderGuide(){
  const srcs = DATA.providers.filter(p=>p.kind==='source');
  const dsts = DATA.providers.filter(p=>p.kind==='target');
  const netMaps = 3, storMaps = 2; // 与「映射配置」页保持一致
  const started = PLANS.filter(p=>p.status!=='draft').length;
  const steps = [
    { t:'接入源平台',
      why:'连接 vCenter / RHV / OpenStack 等虚拟化平台，控制台据此读取虚拟机清单、磁盘与快照信息，是所有迁移操作的数据基础。',
      done: srcs.length>0, meta: srcs.length?`已接入 ${srcs.length} 个源平台`:'尚未接入任何源平台',
      tags: srcs.slice(0,2).map(p=>p.name.split(' · ')[0]), op: srcs.length?'查看平台':'去接入', href:'#/providers' },
    { t:'添加目标集群',
      why:'指定虚拟机迁入的 KubeVirt / OpenShift 集群，迁移完成后虚拟机将以 VM CR 形式在目标集群上运行。',
      done: dsts.length>0, meta: dsts.length?`已添加 ${dsts.length} 个目标集群`:'尚未添加目标集群',
      tags: dsts.map(p=>p.name), op: dsts.length?'查看集群':'去添加', href:'#/providers' },
    { t:'创建网络映射',
      why:'定义「源端口组 → pod 网络 / Multus NAD」的对应关系，保证迁移后虚拟机网络可达、静态 IP 与 VLAN 规划一致。',
      done: netMaps>0, meta: netMaps?`${netMaps} 条网络映射已保存`:'网络未规划将导致迁后失联',
      tags: ['prod 基线','管理网专用'], op: netMaps?'查看映射':'去创建', href:'#/mappings' },
    { t:'创建存储映射',
      why:'指定源 datastore 落入的目标 StorageClass，虚拟机磁盘将转换为 PVC 并按所选存储类调度与重建。',
      done: storMaps>0, meta: storMaps?`${storMaps} 条存储映射已保存`:'未映射 datastore 的虚拟机将被跳过',
      tags: ['主数据映射','归档专用'], op: storMaps?'查看映射':'去创建', href:'#/mappings' },
    { t:'启动首个迁移计划',
      why:'圈选虚拟机创建迁移计划：先预热增量拷贝（源端业务不中断），再在切换窗口内完成分钟级割接。',
      done: started>0, meta: started?`${started} 个计划已启动`:'从一个小批次开始验证流程',
      tags: started?['预热中 '+started+' · 累计完成 '+fmt(PLANS.reduce((a,p)=>a+planVMsOk(p),0))+' 台']:[],
      op: started?'查看计划':'新建迁移', href: started?'#/plans':'#/wizard' },
  ];
  const doneCount = steps.filter(s=>s.done).length;
  const curIdx = steps.findIndex(s=>!s.done);
  const allReady = doneCount===steps.length;
  return `
  <div class="card guide">
    <div class="guide-head">
      <div class="g-title">${ic('swap')}迁移准备引导</div>
      <div class="readiness">就绪度 <b>${doneCount}/${steps.length}</b>${allReady?'<span class="badge b-ok" style="font-size:10.5px">环境已就绪</span>':''}</div>
    </div>
    <div class="guide-bar"><i style="width:${doneCount/steps.length*100}%"></i></div>
    ${steps.map((s,i)=>{
      const cls = s.done?'done': i===curIdx?'cur':'';
      const st = s.done?'<span class="badge b-ok" style="font-size:10px">已完成</span>'
        : i===curIdx?'<span class="badge b-run" style="font-size:10px">下一步</span>'
        : '<span class="badge b-idle" style="font-size:10px">待完成</span>';
      return `<div class="gd-step ${cls}">
        <div class="gd-no">${s.done?ic('check'):i+1}</div>
        <div class="gd-body">
          <b>${s.t} ${st}</b>
          <p>${s.why}</p>
          <div class="gd-meta">
            <span class="tag" style="${s.done?'':'color:var(--text-1)'}">${s.meta}</span>
            ${s.tags.map(t=>`<span class="tag">${t}</span>`).join('')}
            <span class="g-op"><button class="btn ${s.done?'btn-ghost':'btn-primary'} btn-sm" onclick="go('${s.href}')">${s.op} ${ic('arrow',12)}</button></span>
          </div>
        </div>
      </div>`;
    }).join('')}
    ${allReady?`
    <div class="gd-allready">${ic('check')}<div style="flex:1"><b>迁移环境已全部就绪</b><small>建议按 Web 层 → 应用层 → 数据层的顺序分批迁移，预热阶段不影响源端业务</small></div>
      <button class="btn btn-primary btn-sm" onclick="go('#/wizard')">${ic('bolt',12)} 新建迁移</button></div>`:''}
  </div>`;
}
function spark(pts){
  const w=88,h=30,max=Math.max(...pts),min=Math.min(...pts);
  const d = pts.map((p,i)=>`${i?'L':'M'}${(i/(pts.length-1)*w).toFixed(1)},${(h-2-(p-min)/(max-min||1)*(h-6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}"><path d="${d}" style="fill:none;stroke:url(#sparkg);stroke-width:2;filter:drop-shadow(0 0 4px rgba(34,211,238,.5))"/><defs><linearGradient id="sparkg" x1="0" x2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#7c8cf8"/></linearGradient></defs></svg>`;
}

/* ═══════════════ 渲染：向导 ═══════════════ */
const WZ_STEPS = [
  ['选择平台','源与目标'],
  ['网络映射','网络一致性'],
  ['存储映射','存储类映射'],
  ['选择虚拟机','迁移范围'],
  ['迁移设置','策略与窗口'],
  ['预检执行','就绪检查'],
];
function renderWizard(){
  const w = S.wizard, $v = $('[data-view="wizard"]');
  const steps = WZ_STEPS.map((s,i)=>{
    const n = i+1, cls = n<w.step?'done cur-':n===w.step?'cur':'';
    return `<div class="wz-step ${cls} ${n<w.step?'clickable':''}" ${n<w.step?`onclick="wzGoto(${n})"`:''}>
      <div class="no">${n<w.step?ic('check',13):n}</div>
      <div class="txt"><b>${s[0]}</b><small>${s[1]}</small></div>
    </div>`;
  }).join('');
  $v.innerHTML = `
  <div class="view-head"><div><h1>新建迁移</h1><p>跟随向导完成一次批次迁移：预热不中断业务，切换窗口内完成割接</p></div></div>
  <div class="wz-steps">${steps}</div>
  <div class="wz-body" id="wz-body"></div>
  ${wzFoot()}`;
  renderWzStep();
}
function wzFoot(){
  const w = S.wizard;
  let info = '';
  if(w.step===4 && w.sel.size) info = `已选择 <b>${w.sel.size}</b> 台虚拟机`;
  if(w.step===2) info = `网络映射 <b>${Object.values(w.netMap).filter(Boolean).length}</b> / ${DATA.netSources.length} 条`;
  if(w.step===3) info = `存储映射 <b>${Object.values(w.storMap).filter(Boolean).length}</b> / ${DATA.storSources.length} 条`;
  if(w.step===5) info = w.type==='warm' ? `温迁移：先预热增量拷贝，切换窗口仅 <b>分钟级</b> 停机` : `冷迁移：全程停机拷贝`;
  return `<div class="wz-foot">
    <div class="info">${info||'按步骤顺序完成配置，已完成步骤可点击回退修改'}</div>
    <div class="btns">
      ${w.step>1?`<button class="btn btn-ghost" onclick="wzGoto(${w.step-1})">上一步</button>`:''}
      ${w.step<6?`<button class="btn btn-primary" id="wz-next" onclick="wzNext()">${w.step===5?'预检':'下一步'} ${ic('arrow',14)}</button>`
        :`<button class="btn btn-primary" id="wz-launch" onclick="wzLaunch()" ${w.pfDone?'':'disabled'}>${ic('bolt',14)} 启动迁移预热</button>`}
    </div>
  </div>`;
}
function wzGoto(n){ S.wizard.step=n; renderWizard(); }
function wzNext(){
  const w = S.wizard;
  if(w.step===1 && (!w.src||!w.dst)) return toast('err','请选择平台','需要指定源平台与目标集群');
  if(w.step===2){ const un = DATA.netSources.filter(n=>!w.netMap[n.id]).length;
    if(un){ wzAutoMap(true); toast('info','已应用智能映射','已按 VLAN 规则匹配目标网络，可点击已完成步骤回退调整'); wzGoto(3); return; } }
  if(w.step===3){ const un = DATA.storSources.filter(s=>!w.storMap[s.id]).length;
    if(un){ wzStorAuto(); toast('info','已应用推荐存储映射','按 datastore 类型匹配了目标 StorageClass，可回退调整'); wzGoto(4); return; } }
  if(w.step===4 && !w.sel.size) return toast('err','未选择虚拟机','请至少勾选一台虚拟机');
  wzGoto(Math.min(6,w.step+1));
  if(S.wizard.step===6) startPreflight();
}
function renderWzStep(){
  const w = S.wizard, b = $('#wz-body');
  if(w.step===1){
    const srcs = DATA.providers.filter(p=>p.kind==='source');
    const dsts = DATA.providers.filter(p=>p.kind==='target');
    b.innerHTML = `
    <div class="card"><div class="card-title">${ic('server')}源平台 <span class="hint">选择待迁移虚拟机所在的平台</span></div>
      <div class="opt-grid">${srcs.map(p=>optCard(p,w.src===p.id,`wzSel('src','${p.id}')`)).join('')}</div>
    </div>
    <div style="height:14px"></div>
    <div class="card"><div class="card-title">${ic('cake')}目标集群 <span class="hint">虚拟机将以 KubeVirt CR 形式运行</span></div>
      <div class="opt-grid">${dsts.map(p=>optCard(p,w.dst===p.id,`wzSel('dst','${p.id}')`)).join('')}</div>
    </div>`;
  }
  else if(w.step===2){
    b.innerHTML = `
    <div class="card">
      <div class="card-title">${ic('net')}网络映射
        <span class="hint">将源端口组映射到目标 pod 网络 / Multus NAD，未映射网络的网卡将被忽略</span>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="wzAutoMap(true)">${ic('bolt',12)} 智能映射</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
      ${DATA.netSources.map(n=>{
        const tgt = w.netMap[n.id]||'';
        return `<div class="map-row ${tgt?'':'unmapped'}">
          <div class="map-endpoint"><div class="ep-icon">${ic('net')}</div><div class="ep-txt"><b>${n.name}</b><small>${n.type}${n.vlan?' · VLAN '+n.vlan:''} · ${n.usedBy} 台 VM 在用</small></div></div>
          <div class="map-arrow">${ic('arrow')}</div>
          <div class="map-endpoint dst">
            <div class="ep-icon">${ic(tgt&&tgt.startsWith('nad')?'layers':'cloud')}</div>
            <div class="ep-txt" style="flex:1">
              <select class="select" style="padding:6px 30px 6px 10px;font-size:12.5px" onchange="wzNet('${n.id}',this.value)">
                <option value="">— 选择目标网络 —</option>
                ${DATA.netDests.map(d=>`<option value="${d.id}" ${tgt===d.id?'selected':''}>${d.name}${d.type==='multus'?` · ${d.ns}`:''}</option>`).join('')}
              </select>
            </div>
          </div>
          <select class="select" style="padding:6px 30px 6px 10px;font-size:12px;color:var(--text-1)" onchange="wzNetMode('${n.id}',this.value)">
            <option value="preserve" ${w['nm_'+n.id]!=='dhcp'?'selected':''}>保留静态 IP</option>
            <option value="dhcp" ${w['nm_'+n.id]==='dhcp'?'selected':''}>目标侧 DHCP</option>
          </select>
        </div>`;
      }).join('')}
      </div>
      <div class="note info" style="margin-top:14px">${ic('info')}<div><b>保留静态 IP（preserve）</b><p>迁移后虚拟机网卡将继承源端静态 IP/DNS/路由配置，需确保目标网络可达；业务网建议选择对应 Multus NAD。</p></div></div>
    </div>`;
  }
  else if(w.step===3){
    b.innerHTML = `
    <div class="card">
      <div class="card-title">${ic('db')}存储映射
        <span class="hint">源 datastore → 目标 StorageClass，容量已预校验</span>
        <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="wzStorAuto()">${ic('bolt',12)} 推荐映射</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px">
      ${DATA.storSources.map(s=>{
        const tgt = w.storMap[s.id]||'';
        return `<div class="map-row ${tgt?'':'unmapped'}">
          <div class="map-endpoint"><div class="ep-icon">${ic('db')}</div><div class="ep-txt"><b>${s.name}</b><small>${s.type} · 容量 ${s.capTB} TB · 已用 ${s.usedPct}%</small></div></div>
          <div class="map-arrow">${ic('arrow')}</div>
          <div class="map-endpoint dst"><div class="ep-icon">${ic('layers')}</div>
            <div class="ep-txt" style="flex:1">
              <select class="select" style="padding:6px 30px 6px 10px;font-size:12.5px" onchange="wzStor('${s.id}',this.value)">
                <option value="">— 选择 StorageClass —</option>
                ${DATA.storDests.map(d=>`<option value="${d.id}" ${tgt===d.id?'selected':''}>${d.name}${d.def?' · 默认':''}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="text-align:right"><div class="progress ok" style="width:110px"><i style="width:${100-s.usedPct}%"></i></div><small style="color:var(--text-2);font-size:10.5px">剩余 ${((s.capTB*(100-s.usedPct)/100)).toFixed(1)} TB</small></div>
        </div>`;
      }).join('')}
      </div>
      ${(() => {
        const selVol = [...w.sel].reduce((a,id)=>{const v=DATA.vmCatalog.find(x=>x.id===id);return a+(v?v.disk:0)},0);
        return `<div class="note ${selVol>500?'warn':'info'}" style="margin-top:14px">${ic(selVol>500?'warn':'info')}<div>
          <b>本批次数据量约 ${GB(selVol)}</b><p>${selVol>500?'目标 Ceph 集群剩余容量充足但建议错峰执行大容量批次。':'目标集群容量充裕，预热传输将走专用迁移网络 nad-migration-net。'}</p></div></div>`;
      })()}
    </div>`;
  }
  else if(w.step===4){
    const clusters = ['全部',...new Set(DATA.vmCatalog.map(v=>v.cluster))];
    const list = DATA.vmCatalog.filter(v=>(w.cluster==='全部'||v.cluster===w.cluster) && (!w.filter||v.name.includes(w.filter)||v.ip.includes(w.filter)));
    b.innerHTML = `
    <div class="card">
      <div class="card-title">${ic('vm')}选择虚拟机 <span class="hint">来自 vCenter 生产虚拟化平台 · ${DATA.vmCatalog.length} 台可选</span></div>
      <div class="vm-toolbar">
        <div class="global-search" style="width:250px">${ic('search')}<input placeholder="按名称 / IP 过滤" value="${esc(w.filter)}" oninput="wzFilter(this.value)"></div>
        ${clusters.map(c=>`<span class="chip ${w.cluster===c?'on':''}" onclick="wzCluster('${c}')">${c}</span>`).join('')}
        <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="wzSelAll(true)">${w.sel.size===DATA.vmCatalog.length?'取消全选':'全选'}</button>
      </div>
      <table class="table">
        <thead><tr><th style="width:36px"></th><th>虚拟机</th><th>IP 地址</th><th>集群</th><th>规格</th><th>磁盘</th><th>快照</th><th>系统</th><th>温迁移</th><th>提示</th></tr></thead>
        <tbody>
        ${list.map(v=>{ const on = w.sel.has(v.id); return `
          <tr class="clickable" onclick="wzToggle('${v.id}')">
            <td><button class="checkbox ${on?'on':''}"></button></td>
            <td><b>${v.name}</b></td>
            <td class="num">${v.ip}</td>
            <td>${v.cluster}</td>
            <td class="num">${v.cpu}C / ${v.mem}G</td>
            <td class="num">${GB(v.disk)}</td>
            <td class="num">${v.snap||'—'}</td>
            <td>${v.os}</td>
            <td>${v.warm?`<span style="color:var(--ok)">${ic('check',13)}</span>`:`<span style="color:var(--text-2)">—</span>`}</td>
            <td>${v.flag==='snapshot'?`<span class="badge b-warn" style="font-size:10.5px">存在快照</span>`:v.flag==='shared'?`<span class="badge b-warn" style="font-size:10.5px">共享磁盘</span>`:v.flag==='no-warm'?`<span class="badge b-idle" style="font-size:10.5px">仅冷迁移</span>`:'—'}</td>
          </tr>`;}).join('')}
        </tbody>
      </table>
      ${w.sel.size? selectionBar() : ''}
    </div>`;
  }
  else if(w.step===5){
    b.innerHTML = `
    <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:14px">
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="card-title">${ic('pin')}目标命名空间</div>
          <div class="field"><label>虚拟机迁入的命名空间</label>
            <div style="display:flex;gap:10px">
              <select class="select" style="flex:1" onchange="S.wizard.ns=this.value">
                ${DATA.namespaces.map(n=>`<option ${w.ns===n?'selected':''}>${n}</option>`).join('')}
              </select>
              <button class="btn btn-ghost" onclick="toast('info','新建命名空间','已切换为输入模式（演示）')">${ic('bolt',13)} 新建</button>
            </div>
            <div class="help">迁入后虚拟机将以 VM CR 运行，原 vCenter 文件夹结构将转换为 Label</div>
          </div>
        </div>
        <div class="card">
          <div class="card-title">${ic('clock')}迁移方式</div>
          <div class="mt-grid" style="grid-template-columns:1fr 1fr">
            ${mtCard('warm','温迁移 · 推荐','Warm Transfer','业务不中断，多轮增量预拷贝后，在切换窗口内完成最后增量与割接，停机仅分钟级。',['源端持续运行','切换窗口可预约','支持静态 IP 保留'], w.type==='warm', "wzSet('type','warm')")}
            ${mtCard('cold','冷迁移','Cold Transfer','源端关机后全量拷贝，适合可停机的系统或温迁移不支持的虚拟机。',['流程简单可靠','适合测试/灰度','一次性全量拷贝'], w.type==='cold', "wzSet('type','cold')")}
          </div>
          ${w.type==='warm'?`
          <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="field"><label>切换窗口（cutover）</label>
              <select class="select" onchange="S.wizard.cutover=this.value">
                <option value="now" ${w.cutover==='now'?'selected':''}>预热完成后手动触发</option>
                <option value="tomorrow" ${w.cutover==='tomorrow'?'selected':''}>明日 22:00 - 02:00</option>
                <option value="weekend" ${w.cutover==='weekend'?'selected':''}>周六 22:00 - 06:00</option>
              </select>
            </div>
            <div class="field"><label>每台虚拟机切换保护</label>
              <select class="select"><option>未确认允许跳过（默认）</option><option>逐台人工确认</option></select>
            </div>
          </div>`:''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card">
          <div class="card-title">${ic('cpu')}实例类型策略</div>
          <div style="display:flex;flex-direction:column;gap:9px">
            ${[['auto','自动推荐','按源规格匹配 KubeVirt instance-type，如 4C/8G → u1.medium'],['preserve','保持源规格','严格保留源 vCPU/内存与 CPU 型号'],].map(([k,t,d])=>`
            <label class="opt-card ${w.instPolicy===k?'on':''}" style="cursor:pointer" onclick="wzSet('instPolicy','${k}')">
              <div class="head" style="margin:0"><div><b>${t}</b><small style="white-space:normal">${d}</small></div>
              <span class="check">${ic('check')}</span></div>
            </label>`).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-title">${ic('wrench')}迁移钩子（Hook）<span class="hint">可选</span></div>
          <div style="display:flex;flex-direction:column;gap:9px">
          ${DATA.hooks.map(h=>`<label class="opt-card ${w.hook===h.id?'on':''}" style="cursor:pointer" onclick="wzSet('hook','${w.hook===h.id?'':h.id}')">
            <div class="head" style="margin:0"><div><b>${h.name}</b><small>${h.play} · ${h.phase==='preCutover'?'切换前':'切换后'}执行</small></div><span class="check">${ic('check')}</span></div>
          </label>`).join('')}
          </div>
        </div>
      </div>
    </div>`;
  }
  else if(w.step===6){
    b.innerHTML = `
    <div class="card" style="max-width:720px;margin:0 auto;padding:26px 30px">
      <div style="text-align:center;margin-bottom:22px">
        <div style="width:58px;height:58px;border-radius:18px;background:var(--grad);display:grid;place-items:center;margin:0 auto 14px;color:#04121f">${ic('shield',26)}</div>
        <h2 style="font-size:19px">迁移就绪检查</h2>
        <p style="color:var(--text-2);font-size:12.5px;margin-top:4px">汇总计划：${w.sel.size} 台虚拟机 · ${w.type==='warm'?'温迁移':'冷迁移'} → 命名空间 ${w.ns}</p>
      </div>
      <div class="preflight" id="preflight"></div>
      <div class="note info" style="margin-top:16px">${ic('info')}<div><b>执行流程</b><p>启动后将进入「预拷贝」阶段增量同步磁盘（源端业务不受影响）；预拷贝完成后，在切换窗口执行分钟级割接（virt-v2v 转换 → 拉起虚拟机 → 健康验证）。</p></div></div>
    </div>`;
  }
}
function optCard(p,on,fn){
  return `<div class="opt-card ${on?'on':''}" onclick="${fn}">
    <span class="check">${ic('check')}</span>
    <div class="head">
      <div class="icon">${p.type==='vsphere'?ic('server'):p.type==='ovirt'?ic('layers'):p.type==='openstack'?ic('cloud'):ic('cake')}</div>
      <div><b>${p.name}</b><small>${p.version}</small></div>
    </div>
    <div class="meta">
      <span class="tag">${p.vms} VM</span>
      <span class="tag">${p.hosts} 主机</span>
      <span class="tag">${p.usedTB}/${p.capTB} TB</span>
      ${p.status==='warn'?`<span class="tag" style="color:var(--warn);border-color:rgba(251,191,36,.4)">⚠ ${p.warnMsg||'注意'}</span>`:''}
    </div>
  </div>`;
}
function mtCard(icon_,t,en,d,pros,on,fn){
  return `<div class="mt-card ${on?'on':''}" onclick="${fn}">
    <div class="ic">${ic(icon_)}</div><b>${t}</b><div class="sub">${en}</div><p>${d}</p>
    <div class="pros">${pros.map(p=>`<span>${ic('check')}${p}</span>`).join('')}</div>
  </div>`;
}
function selectionBar(){
  const w = S.wizard;
  const vols = [...w.sel].map(id=>DATA.vmCatalog.find(v=>v.id===id)).filter(Boolean);
  const disk = vols.reduce((a,v)=>a+v.disk,0);
  const eta = Math.max(5, Math.round(disk/ (vols.length>6?280:180) /60*1.15));
  const noWarm = vols.some(v=>!v.warm);
  return `<div class="selection-bar">
    <div class="s-item"><b>${vols.length}</b>台虚拟机</div>
    <div class="s-item"><b>${GB(disk)}</b>数据量</div>
    <div class="s-item"><b>${eta}</b>分钟 · 预估预热耗时</div>
    <div class="s-item"><b>${vols.reduce((a,v)=>a+v.cpu,0)}</b>vCPU · <b>${vols.reduce((a,v)=>a+v.mem,0)}</b>GiB</div>
    ${noWarm?`<div class="s-item" style="color:var(--warn)">含 ${vols.filter(v=>!v.warm).length} 台仅支持冷迁移</div>`:''}
    <button class="btn btn-ghost btn-sm clear" onclick="wzSelAll(false)">清空</button>
  </div>`;
}
/* 向导交互 */
const wzSel = (k,v)=>{ S.wizard[k]=v; renderWizard(); };
const wzSet = (k,v)=>{ S.wizard[k]=v; renderWizard(); };
function wzAutoMap(force){
  const w=S.wizard;
  if(force || true){ w.netMap={n1:'pod',n2:'nad-vlan10',n3:'nad-vlan20',n4:'ignored',n5:'ignored'}; w.confirmNet=true; renderWizard(); }
}
function wzStorAuto(){ S.wizard.storMap={ds1:'sc1',ds2:'sc1',ds3:'sc3'}; renderWizard(); }
const wzNet=(k,v)=>{ S.wizard.netMap[k]=v; renderWizard(); };
const wzNetMode=(k,v)=>{ S.wizard['nm_'+k]=v; };
const wzStor=(k,v)=>{ S.wizard.storMap[k]=v; renderWizard(); };
const wzFilter=v=>{ S.wizard.filter=v; renderWzStep(); };
const wzCluster=c=>{ S.wizard.cluster=c; renderWzStep(); };
function wzToggle(id){ const s=S.wizard.sel; s.has(id)?s.delete(id):s.add(id); renderWzStep(); }
function wzSelAll(on){ S.wizard.sel = on?new Set(DATA.vmCatalog.map(v=>v.id)):new Set(); renderWzStep(); }

/* 预检 */
function startPreflight(){
  const w=S.wizard;
  const checks = [
    { t:'源平台连接与凭据', s:`vcsa-prod.corp.local · vSphere 8.0.3 · 会话有效` },
    { t:'目标集群可达性', s:`api.cnv-prod.corp.local:6443 · kubevirt API 就绪` },
    { t:'网络映射完整性', s:`${Object.values(w.netMap).filter(Boolean).length} 条网络映射 · ${w.sel.size||0} 台 VM 网卡均已覆盖` },
    { t:'存储映射与容量', s:`目标 Ceph RBD 剩余 178.8 TB > 本批次 ${GB([...w.sel].reduce((a,id)=>a+(DATA.vmCatalog.find(v=>v.id===id)?.disk||0),0))}` },
    { t:'VDDK 传输镜像', s:`vddk:8.0.3 已同步至 registry.corp.local/forklift/` },
    { t:'virt-v2v 转换器调度', s:`转换节点池 3 节点可用 · 专用迁移网络已配置` },
  ];
  w.pfItems = checks.map(c=>({...c,state:'pending'}));
  w.pfDone=false;
  const box=$('#preflight'); if(!box) return;
  box.innerHTML = w.pfItems.map((c,i)=>`<div class="pf-item" style="animation-delay:${i*.12}s"><div class="pf-ic">${ic('info')}</div><div><b>${c.t}</b><small>${c.s}</small></div><span class="state">等待</span></div>`).join('');
  w.pfItems.forEach((c,i)=>{
    setTimeout(()=>{ if(S.wizard.step!==6) return;
      const el = box.children[i]; if(!el) return;
      el.className='pf-item checking'; el.querySelector('.state').textContent='检查中…';
      el.querySelector('.pf-ic').innerHTML = `<svg viewBox="0 0 24 24" style="animation:rot 1s linear infinite"><path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
      setTimeout(()=>{ if(S.wizard.step!==6) return;
        el.className='pf-item pass'; el.querySelector('.state').textContent='通过';
        el.querySelector('.state').style.color='var(--ok)';
        el.querySelector('.pf-ic').innerHTML=ic('check');
        if(i===w.pfItems.length-1){ w.pfDone=true; const btn=$('#wz-launch'); if(btn){btn.disabled=false;} toast('ok','预检通过','所有就绪条件满足，可以启动迁移'); }
      }, 620+S.speed*0);
    }, 400+i*430);
  });
}
function wzLaunch(){
  const w=S.wizard; if(!w.pfDone) return;
  const vms=[...w.sel].map(id=>mkPlanVM(DATA.vmCatalog.find(v=>v.id===id),'staging',2)).filter(v=>v.name);
  const id='pl-'+Math.random().toString(36).slice(2,6);
  PLANS.unshift({ id, name:`批次迁移 · ${new Date().getMonth()+1}-${new Date().getDate()} ${now()}`, desc:`向导创建 · ${vms.length} 台虚拟机`,
    src:w.src, dst:w.dst, type:w.type, ns:w.ns, status:'staging', created:`10-21 ${now()}`, instPolicy:w.instPolicy, cutoverAt:null,
    vms, throughput:0, startedAt:`10-21 ${now()}` });
  pushEvent(`<b>${id}</b> 迁移计划已创建并开始预拷贝（${vms.length} 台）`);
  toast('ok','迁移计划已启动',`进入预拷贝阶段，共 ${vms.length} 台虚拟机`);
  resetWizard();
  location.hash='#/plan/'+id;
}
function resetWizard(){ S.wizard={ ...S.wizard, step:1, sel:new Set(), netMap:{}, storMap:{}, filter:'', cluster:'全部', pfDone:false, pfItems:[] }; }

/* ═══════════════ 渲染：计划列表 ═══════════════ */
function renderPlans(){
  const filters=['全部','进行中','待切换','已完成','草稿'];
  const map={全部:()=>true,进行中:p=>['staging','cutting','queued'].includes(p.status),待切换:p=>p.status==='ready',已完成:p=>p.status==='done',草稿:p=>p.status==='draft'};
  const list=PLANS.filter(map[S.plansFilter]);
  $('[data-view="plans"]').innerHTML=`
  <div class="view-head">
    <div><h1>迁移计划</h1><p>${PLANS.length} 个计划 · 预热不影响源端业务，切换窗口内完成割接</p></div>
    <div class="actions">
      <div class="tabs">${filters.map(f=>`<button class="${S.plansFilter===f?'on':''}" onclick="S.plansFilter='${f}';renderPlans()">${f}</button>`).join('')}</div>
      <button class="btn btn-primary" onclick="go('#/wizard')">${ic('bolt',14)} 新建迁移</button>
    </div>
  </div>
  <div class="plan-grid">${list.map(planCard).join('') || `<div class="card table-empty">该筛选下没有计划</div>`}</div>`;
}
function planCard(p){
  const ok=planVMsOk(p), meta=planStatusMeta[p.status];
  const src=DATA.providers.find(x=>x.id===p.src), dst=DATA.providers.find(x=>x.id===p.dst);
  const pct=planProgress(p);
  return `<div class="plan-card" onclick="location.hash='#/plan/${p.id}'">
    <div class="top"><h3>${p.name}</h3><span class="badge ${meta.cls}" style="margin-left:auto">${meta.lbl}</span></div>
    <div class="src-dst">${ic('server')} ${src?.type.toUpperCase()} <span class="mono">${src?.url.split('.')[0]}</span> ${ic('arrowR','')} ${ic('cake')} ${dst?dst.type.toUpperCase():''} <span class="mono">${p.ns}</span></div>
    <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--text-2);margin-bottom:7px">
      <span>${p.type==='warm'?'温迁移':'冷迁移'} · ${p.vms.length} 台</span><span class="mono">${p.created}</span>
    </div>
    <div class="progress ${p.status==='done'?'ok':''}"><i style="width:${p.status==='draft'?0:pct.toFixed(1)}%"></i></div>
    <div class="stats">
      <div><b>${p.status==='draft'?'—':ok+' / '+p.vms.length}</b><small>已完成</small></div>
      <div><b>${p.status==='draft'?'—':p.status==='done'?'100%':pct.toFixed(0)+'%'}</b><small>整体进度</small></div>
      <div><b>${p.status==='staging'?estEta(p):p.status==='ready'?'待排期':p.status==='done'?'—':'切窗中'}</b><small>${p.status==='staging'?'预估剩余':p.status==='ready'?'切换时间':p.status==='done'?'总耗时':'状态'}</small></div>
    </div>
    <div class="foot">
      <span class="badge b-idle" style="font-size:10.5px">${p.instPolicy==='auto'?'实例类型自动推荐':'保持源规格'}</span>
      ${p.hookApplied?`<span class="badge b-idle" style="font-size:10.5px">含 Hook</span>`:''}
      <span class="mono">${p.throughput?p.throughput+' MB/s':''}</span>
      <span style="color:var(--brand-1);font-size:12px;margin-left:auto;display:inline-flex;align-items:center;gap:5px">详情 ${ic('arrow',13)}</span>
    </div>
  </div>`;
}

/* ═══════════════ 渲染：计划详情 ═══════════════ */
function renderPlanDetail(id){
  const p=PLANS.find(x=>x.id===id); if(!p){ location.hash='#/plans'; return; }
  const meta=planStatusMeta[p.status];
  const running=['staging','cutting'].includes(p.status);
  const doneVMs=planVMsOk(p);
  const vmsAgg = p.vms.reduce((a,v)=>{a[v.phase]=(a[v.phase]||0)+1;return a;},{});
  $('[data-view="plan"]').innerHTML=`
  <div style="margin-bottom:18px"><a href="#/plans" style="color:var(--text-2);font-size:12.5px;display:inline-flex;align-items:center;gap:6px">← 返回计划列表</a></div>
  <div class="card plan-head" style="margin-bottom:14px">
    <div class="info">
      <h1>${p.name} <span class="badge ${meta.cls}">${meta.lbl}</span></h1>
      <div class="meta">
        <span>${ic('server')} vSphere → ${ic('cake')} KubeVirt</span>
        <span>${ic('pin')} 命名空间 <span class="mono">${p.ns}</span></span>
        <span>${ic('clock')} ${p.type==='warm'?'温迁移':'冷迁移'}</span>
        <span>${ic('file')} 创建于 ${p.created}</span>
        ${p.cutoverAt?`<span style="color:var(--cutover)">${ic('cutover')} 切换窗口 ${p.cutoverAt}</span>`:''}
      </div>
    </div>
    <div class="plan-actions">
      ${p.status==='draft'?`<button class="btn btn-primary" onclick="startPlan('${p.id}')">${ic('play',14)} 启动迁移</button>`:''}
      ${p.status==='ready'?`<button class="btn btn-primary" style="background:linear-gradient(135deg,#fb923c,#f43f5e);color:#fff" onclick="cutoverModal('${p.id}')">${ic('cutover',14)} 执行切换</button>`:''}
      ${p.status==='staging'?`<button class="btn btn-ghost" onclick="toast('info','预热继续进行','增量拷贝在后台运行，不影响源端业务')">${ic('pause',14)} 暂停预热</button>`:''}
      ${running||p.status==='ready'?`<button class="btn btn-danger" onclick="cancelPlan('${p.id}')">${ic('stop',13)} 取消计划</button>`:''}
      ${p.status==='done'?`<button class="btn btn-ghost" onclick="exportReport('${p.id}')">${ic('file',14)} 导出报告</button>`:''}
    </div>
  </div>

  <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
    <div class="stat-cell"><b>${doneVMs} <em>/ ${p.vms.length} 台</em></b><small>迁移完成</small></div>
    <div class="stat-cell"><b>${p.status==='draft'?'—':planProgress(p).toFixed(1)+'<em>%</em>'}</b><small>整体进度</small></div>
    <div class="stat-cell">
      <div class="speedometer"><b>${p.throughput||0}</b><small>MB/s</small></div>
      <small style="color:var(--text-2);font-size:11px">实时传输速率</small>
    </div>
    <div class="stat-cell"><b>${p.status==='staging'?estEta(p):p.status==='done'?'6m12s':'—'}</b><small>${p.status==='staging'?'预估剩余时间':'切换窗口耗时'}</small></div>
  </div>

  ${p.status==='ready'?`
  <div class="note warn" style="margin-bottom:14px">${ic('warn')}<div><b>预热已完成，等待割接</b>
    <p>${p.vms.length} 台虚拟机已同步至最新增量。执行切换时源端将关机并完成最终拷贝与 virt-v2v 转换，预计停机 <b>${p.vms.length*2.5} 分钟</b>。建议在业务低峰执行。</p></div>
  <button class="btn btn-sm" style="background:linear-gradient(135deg,#fb923c,#f43f5e);color:#fff;border:none;margin-top:10px" onclick="cutoverModal('${p.id}')">立即安排切换</button></div>`:''}

  <div class="card">
    <div class="card-title">${ic('vm')}虚拟机明细
      <span class="hint">点击行查看磁盘级进度与事件</span>
      <span style="margin-left:auto" class="mini-legend">
        ${Object.entries(vmsAgg).map(([k,n])=>`<span><i style="background:${vmPhaseColor(k)}"></i>${vmStatusMeta[k]?.lbl||k} ${n}</span>`).join('')}
      </span>
    </div>
    <table class="table">
      <thead><tr><th>虚拟机</th><th>规格 / 磁盘</th><th class="phase-cell">迁移阶段</th><th style="width:13%">进度</th><th>预估切换停机</th><th>状态</th><th></th></tr></thead>
      <tbody>
      ${p.vms.map(v=>`
        <tr class="clickable" onclick="vmDrawer('${p.id}','${v.id}')">
          <td><b>${v.name}</b><br><small class="mono" style="color:var(--text-2)">${v.ip}</small></td>
          <td class="num">${v.cpu}C / ${v.mem}G<br><small style="color:var(--text-2)">${GB(v.disk)}</small></td>
          <td class="phase-cell"><div class="pipeline">${pipeline(v)}</div></td>
          <td><div style="display:flex;align-items:center;gap:8px">
            <div class="progress ${v.phase==='succeeded'?'ok':v.phase==='failed'?'err':''}" style="flex:1"><i style="width:${v.progress}%"></i></div>
            <small class="mono" style="color:var(--text-1);width:34px">${v.progress|0}%</small></div></td>
          <td class="num">${['readyForCutover','cutover'].includes(v.phase)?'~2 分钟':v.phase==='succeeded'?'已完成':'—'}</td>
          <td><span class="badge ${vmStatusMeta[v.phase].cls}">${vmStatusMeta[v.phase].lbl}</span></td>
          <td>${['succeeded','canceled'].includes(v.phase)?'':`<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();vmCancel('${p.id}','${v.id}')">取消</button>`}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div class="card" style="margin-top:14px">
    <div class="card-title">${ic('clock')}计划事件</div>
    <div class="event-feed" style="max-height:200px">${(p.events||[
      {t:p.created.slice(6),m:'计划创建，完成就绪检查'},
      {t:p.startedAt?.slice(6)||'—',m:p.status==='draft'?'计划暂存为草稿':'开始预拷贝，虚拟机进入 Staging'},
    ]).map(e=>`<div class="event"><time>${e.t}</time><div class="msg">${e.m}</div></div>`).join('')}</div>
  </div>`;
  S.route='plan'; S.curPlan=id;
}
const vmPhaseColor = k => ({queued:'#5d6e8a',staging:'#22d3ee',readyForCutover:'#fbbf24',cutover:'#fb923c',converting:'#22d3ee',starting:'#38bdf8',succeeded:'#34d399',failed:'#fb7185',canceled:'#5d6e8a'})[k]||'#5d6e8a';
function pipeline(v){
  const seq=['queued','staging','readyForCutover','cutover','converting','starting','succeeded'];
  const cur=PHASE_IDX[v.phase]??0;
  const fail=v.phase==='failed', cancel=v.phase==='canceled';
  return seq.map((ph,i)=>{
    let cls='';
    if(!fail&&!cancel){ cls = i<cur?'done': i===cur?'cur':''; }
    if(fail) cls = i<=Math.min(cur,3)? (i===Math.min(cur,3)?'err':'done'):'';
    if(v.phase==='succeeded') cls='done';
    const lbl = ph==='cutover'?'切换':PHASES.find(x=>x.k===ph).lbl;
    return `<div class="pipe-step ${cls}"><div class="p-dot">${cls==='done'?ic('check'):i===cur&&!cls?PHASES.find(x=>x.k===ph).lbl[0]:ic(fail&&cls==='err'?'x':'check')}</div><div class="p-lbl">${lbl}</div></div>`;
  }).join('');
}
function vmDrawer(pid,vid){
  const p=PLANS.find(x=>x.id===pid), v=p.vms.find(x=>x.id===vid);
  const inst = p.instPolicy==='auto' ? `${v.cpu>=8?'server-x':v.cpu>=4?'u1.large':'u1.medium'}（${v.cpu}C/${v.mem}G 自动匹配）` : `strict-reserve（严格保留 ${v.cpu}C/${v.mem}G）`;
  openDrawer(`
    <div class="drawer-head">
      <div style="width:38px;height:38px;border-radius:11px;background:var(--grad-soft);border:1px solid rgba(34,211,238,.3);display:grid;place-items:center;color:var(--brand-1)">${ic('vm',18)}</div>
      <div><h3>${v.name}</h3><div class="mono" style="font-size:11.5px;color:var(--text-2)">${v.ip} · ${v.os}</div></div>
      <span class="badge ${vmStatusMeta[v.phase].cls}" style="margin-left:6px">${vmStatusMeta[v.phase].lbl}</span>
      <button class="icon-btn drawer-close" onclick="closeDrawer()">${ic('x')}</button>
    </div>
    <div class="drawer-body">
      <div class="card" style="margin-bottom:14px;padding:15px">
        <div style="display:flex;justify-content:space-between;margin-bottom:9px;font-size:12.5px"><b>迁移进度</b><span class="mono" style="color:var(--brand-1)">${v.progress|0}%</span></div>
        <div class="progress"><i style="width:${v.progress}%"></i></div>
      </div>
      <div class="card" style="margin-bottom:14px;padding:15px">
        <div class="card-title" style="margin-bottom:10px">${ic('db')}磁盘明细<span class="hint">预拷贝走迁移网络</span></div>
        ${v.disks.map(([n,sz],i)=>`
        <div style="display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px dashed rgba(148,163,184,.1)">
          <div style="flex:1"><b style="font-size:12.5px">${n}</b> <span class="mono" style="color:var(--text-2);font-size:11px">${sz} GB</span>
          <div class="progress" style="margin-top:6px;height:5px"><i style="width:${Math.max(4,v.progress-(i?4:0))}%"></i></div></div>
          <small class="mono" style="color:var(--text-1)">${(v.progress-(i?4:0))|0}%</small>
        </div>`).join('')}
      </div>
      <div class="card" style="margin-bottom:14px;padding:15px">
        <div class="card-title" style="margin-bottom:10px">${ic('cpu')}规格转换</div>
        <table class="table"><tbody>
          <tr><td style="color:var(--text-2)">源规格</td><td class="num">${v.cpu} vCPU / ${v.mem} GB · ${v.os}</td></tr>
          <tr><td style="color:var(--text-2)">目标实例类型</td><td class="num" style="color:var(--brand-1)">${inst}</td></tr>
          <tr><td style="color:var(--text-2)">目标存储</td><td class="num">ocs-storagecluster-ceph-rbd（PVC 将自动创建）</td></tr>
          <tr><td style="color:var(--text-2)">网络</td><td class="num">nad-vlan10-prod · 保留静态 IP</td></tr>
        </tbody></table>
      </div>
      <div class="card" style="padding:15px">
        <div class="card-title" style="margin-bottom:10px">${ic('clock')}时间线</div>
        ${[['计划创建',p.created],['开始预拷贝',p.startedAt||p.created],v.phase==='succeeded'?['切换完成，虚拟机运行中','10-21 02:14']:['当前阶段：'+vmStatusMeta[v.phase].lbl,'进行中'],]
          .map(([m,t],i)=>`<div style="display:flex;gap:11px;padding:7px 0"><span class="dot ${i<2?'dot-ok':'dot-run'}" style="margin-top:5px"></span><div style="flex:1"><b style="font-size:12.5px;font-weight:500">${m}</b></div><small class="mono" style="color:var(--text-2)">${t}</small></div>`).join('')}
      </div>
    </div>`);
}
function vmCancel(pid,vid){
  const p=PLANS.find(x=>x.id===pid);
  const v=p.vms.find(x=>x.id===vid);
  openModal(`<div class="modal-head"><h3>取消虚拟机迁移</h3></div>
  <div class="modal-body"><div class="note warn">${ic('warn')}<div><b>确认从计划中移除 ${v.name}？</b><p>已拷贝的数据将保留在目标 PVC 中，可随时恢复该虚拟机的迁移。其余 ${p.vms.length-1} 台不受影响。</p></div></div></div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">保留</button>
  <button class="btn btn-danger" onclick="doVmCancel('${pid}','${vid}')">确认取消</button></div>`);
}
function doVmCancel(pid,vid){
  const p=PLANS.find(x=>x.id===pid);
  const v=p.vms.find(x=>x.id===vid);
  v.phase='canceled'; v.progress=0;
  pushEvent(`<b>${v.name}</b> 已从计划 ${pid} 中取消`);
  closeModal(); renderPlanDetail(pid); toast('info','已取消',v.name+' 的迁移已取消，数据保留在目标 PVC');
}
function cancelPlan(pid){
  const p=PLANS.find(x=>x.id===pid);
  openModal(`<div class="modal-head"><h3>取消迁移计划</h3></div>
  <div class="modal-body"><div class="note danger">${ic('warn')}<div><b>确认取消「${p.name}」？</b><p>进行中的 ${p.vms.filter(v=>!['succeeded','canceled'].includes(v.phase)).length} 台虚拟机迁移将中止，源端虚拟机不受影响，不受已迁移完成部分影响。</p></div></div></div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">保留计划</button>
  <button class="btn btn-danger" onclick="doCancelPlan('${pid}')">确认取消</button></div>`);
}
function doCancelPlan(pid){
  const p=PLANS.find(x=>x.id===pid);
  p.vms.forEach(v=>{ if(!['succeeded','canceled'].includes(v.phase)) v.phase='canceled'; });
  p.status='draft'; p.throughput=0;
  pushEvent(`<b>${pid}</b> 计划被取消，可重新编辑后启动`);
  closeModal(); location.hash='#/plans'; toast('info','计划已取消','源端虚拟机未受影响');
}
function cutoverModal(pid){
  const p=PLANS.find(x=>x.id===pid);
  openModal(`
  <div class="modal-head"><div style="width:36px;height:36px;border-radius:11px;background:rgba(251,146,60,.14);border:1px solid rgba(251,146,60,.4);display:grid;place-items:center;color:var(--cutover)">${ic('cutover',17)}</div>
    <h3>执行切换（Cutover）</h3></div>
  <div class="modal-body">
    <div class="note warn" style="margin-bottom:14px">${ic('warn')}<div><b>切换期间源端虚拟机将关机</b><p>预计总停机 <b>${(p.vms.length*2.5).toFixed(0)} 分钟</b>（逐台执行：最终增量拷贝 → virt-v2v 转换 → 目标端拉起）。</p></div></div>
    <div class="field"><label>切换时间</label>
      <select class="select" id="cut-time">
        <option value="now">立即开始（推荐，当前为业务低峰）</option>
        <option value="60">60 分钟后</option>
        <option value="custom">自定义时间…</option>
      </select></div>
    <label style="display:flex;gap:10px;align-items:flex-start;margin-top:14px;padding:12px;border-radius:11px;border:1px dashed var(--stroke-hi);cursor:pointer">
      <button class="checkbox on" id="cut-hook" onclick="this.classList.toggle('on')"></button>
      <div><b style="font-size:12.5px">切换前运行 Hook：停机前摘除监控探针</b><small style="color:var(--text-2);display:block;font-size:11.5px">ansible/ha-pre.yml · pre-cutover · 避免切换期间误报警</small></div>
    </label>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">暂不切换</button>
  <button class="btn btn-primary" style="background:linear-gradient(135deg,#fb923c,#f43f5e);color:#fff" onclick="doCutover('${pid}')">${ic('cutover',14)} 确认切换 ${p.vms.length} 台</button></div>`);
}
function doCutover(pid){
  const p=PLANS.find(x=>x.id===pid);
  p.status='cutting'; p.cutoverAt='10-21 '+now();
  p.vms.forEach(v=>{ if(v.phase==='readyForCutover') v.phase='cutover'; v.progress=100; });
  pushEvent(`<b>${pid}</b> 切换窗口开启，${p.vms.length} 台 VM 进入割接流程`);
  toast('ok','切换已启动','虚拟机将逐台完成最终增量与转换，可在详情页跟踪');
  closeModal(); renderPlanDetail(pid);
}
function startPlan(pid){
  const p=PLANS.find(x=>x.id===pid);
  p.status='staging'; p.startedAt='10-21 '+now();
  p.vms.forEach(v=>{ v.phase='staging'; v.progress=3; });
  pushEvent(`<b>${pid}</b> 计划启动，开始预拷贝`);
  renderPlanDetail(pid); toast('ok','迁移已启动','进入预拷贝阶段');
}
function exportReport(){ toast('ok','报告已生成','migration-report-2026-10-21.pdf 开始下载（演示）'); }

/* ═══════════════ 渲染：平台连接 ═══════════════ */
const PROV_ICON = { vsphere:['server','#3e86e5','VM'], ovirt:['layers','#c63f3f','OV'], openstack:['cloud','#e0559a','OS'], ova:['file','#8b8b8b','OVA'], ec2:['cloud','#f7a04b','EC2'], hyperv:['server','#0088d0','HV'], nutanix:['db','#2f6dd6','NX'], azure:['cloud','#3aa0ec','AZ'], openshift:['cake','#e00b8c','KV'] };
function renderProviders(){
  $('[data-view="providers"]').innerHTML=`
  <div class="view-head">
    <div><h1>平台连接</h1><p>源平台提供虚拟机清单与磁盘读取，目标集群承接 KubeVirt 虚拟机</p></div>
    <div class="actions"><button class="btn btn-primary" onclick="addProviderModal()">${ic('bolt',14)} 接入平台</button></div>
  </div>
  <div class="time-sep">源平台 · SOURCE</div>
  <div class="prov-grid" style="margin-bottom:20px">
    ${DATA.providers.filter(p=>p.kind==='source').map(provCard).join('')}
  </div>
  <div class="time-sep">目标集群 · TARGET</div>
  <div class="prov-grid">
    ${DATA.providers.filter(p=>p.kind==='target').map(provCard).join('')}
  </div>`;
}
function provCard(p){
  const [i,color,brand]=PROV_ICON[p.type]||PROV_ICON.ova;
  return `<div class="prov-card ${p.kind==='source'?'src':'dst'}">
    <div class="head">
      <div class="p-icon" style="background:${color}22;border:1px solid ${color}55;color:${color}">${brand}</div>
      <div style="flex:1;min-width:0">
        <h3><span class="dot ${p.status==='ok'?'dot-ok':'dot-warn'}"></span>${p.name}</h3>
        <div class="url">${p.url}</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--text-2)">
      <span>${p.version}</span><span class="mono">${p.fingerprint||''}</span>
    </div>
    ${p.warnMsg?`<div class="note warn" style="margin-top:10px;padding:8px 12px;font-size:11.5px">${ic('warn')}<div><p>${p.warnMsg}</p></div></div>`:''}
    <div class="p-stats">
      <div><b>${p.vms}</b><small>虚拟机</small></div>
      <div><b>${p.hosts}</b><small>${p.kind==='source'?'宿主机':'节点'}</small></div>
      <div><b>${p.usedTB}<em style="font-size:11px;color:var(--text-2)"> / ${p.capTB} TB</em></b><small>已用容量</small></div>
    </div>
    <div style="height:5px;border-radius:99px;background:rgba(148,163,184,.12);overflow:hidden;margin-bottom:12px">
      <i style="display:block;height:100%;width:${p.usedTB/p.capTB*100}%;background:linear-gradient(90deg,${color}88,${color})"></i>
    </div>
    <div class="ops">
      <button class="btn btn-ghost btn-sm" onclick="testProvider('${p.id}')">${ic('bolt',12)} 测试连接</button>
      <button class="btn btn-ghost btn-sm" onclick="viewProviderDetail('${p.id}')">${ic('eye',12)} 详情</button>
      <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="toast('info','编辑连接','凭据轮转将自动触发清单刷新（演示）')">${ic('gear',12)}</button>
    </div>
  </div>`;
}
function testProvider(id){
  const p=DATA.providers.find(x=>x.id===id);
  toast('ok','连接正常',`${p.name} · 清单已同步（v${p.version}）`);
}
function viewProviderDetail(id){
  const p=DATA.providers.find(x=>x.id===id);
  openModal(`<div class="modal-head"><h3>${p.name}</h3><span class="badge b-ok" style="margin-left:8px">连接正常</span></div>
  <div class="modal-body">
    <table class="table"><tbody>
      <tr><td style="color:var(--text-2);width:130px">类型</td><td class="mono">${p.type}</td></tr>
      <tr><td style="color:var(--text-2)">地址</td><td class="mono">${p.url}</td></tr>
      <tr><td style="color:var(--text-2)">版本</td><td>${p.version}</td></tr>
      <tr><td style="color:var(--text-2)">指纹</td><td class="mono">${p.fingerprint}</td></tr>
      <tr><td style="color:var(--text-2)">凭据</td><td class="mono">secret/${p.id}-credentials <span class="badge b-ok" style="margin-left:6px;font-size:10px">有效</span></td></tr>
      <tr><td style="color:var(--text-2)">清单同步</td><td class="mono">每 10 分钟 · 上次 ${now()}</td></tr>
    </tbody></table>
    ${p.kind==='source'&&p.type==='vsphere'?`<div class="note info" style="margin-top:12px">${ic('info')}<div><b>传输加速已启用</b><p>VDDK 8.0.3 · NBD 立即拷贝 · AIO 优化开启，预拷贝速率可达 300+ MB/s</p></div></div>`:''}
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">关闭</button></div>`);
}
function addProviderModal(){
  openModal(`
  <div class="modal-head"><h3>接入源平台</h3><button class="icon-btn" style="margin-left:auto" onclick="closeModal()">${ic('x')}</button></div>
  <div class="modal-body">
    <div class="field" style="margin-bottom:14px"><label>平台类型</label>
      <select class="select" id="np-type">
        <option value="vsphere">VMware vSphere / vCenter</option>
        <option value="ovirt">Red Hat Virtualization / oVirt</option>
        <option value="openstack">OpenStack</option>
        <option value="hyperv">Microsoft Hyper-V</option>
        <option value="nutanix">Nutanix AHV</option>
        <option value="azure">Microsoft Azure</option>
        <option value="ec2">AWS EC2</option>
        <option value="ova">OVA / OVFTP 导入</option>
      </select></div>
    <div class="field" style="margin-bottom:14px"><label>平台地址</label><input class="input" id="np-url" placeholder="例如 vcsa-new.corp.local"></div>
    <div class="field" style="margin-bottom:14px"><label>凭据（将写入 Secret）</label><input class="input" placeholder="用户名，如 administrator@vsphere.local" style="margin-bottom:8px"><input class="input" type="password" placeholder="密码"></div>
    <label style="display:flex;gap:9px;align-items:center;font-size:12.5px;color:var(--text-1)"><button class="checkbox on"></button> 跳过 TLS 证书校验（内网自签环境）</label>
  </div>
  <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">取消</button>
  <button class="btn btn-primary" onclick="doAddProvider()">${ic('bolt',14)} 测试并接入</button></div>`);
}
function doAddProvider(){
  const type=$('#np-type').value, url=$('#np-url')?.value||'new-platform.corp.local';
  const nameMap={vsphere:'新接入 vCenter',ovirt:'新接入 RHV',openstack:'新接入 OpenStack',hyperv:'新接入 Hyper-V',nutanix:'新接入 Nutanix',azure:'新接入 Azure',ec2:'新接入 EC2',ova:'OVA 导入源'};
  DATA.providers.unshift({ id:'p-'+Math.random().toString(36).slice(2,6), kind:'source', type, brand:PROV_ICON[type][2], name:nameMap[type], url, version:'已识别', status:'ok', vms:0, clusters:1, hosts:'—', capTB:0, usedTB:0, fingerprint:'fp-'+Math.random().toString(36).slice(2,8) });
  closeModal(); renderProviders(); toast('ok','平台已接入','清单发现完成，可在向导中选择该平台');
}

/* ═══════════════ 渲染：映射配置 ═══════════════ */
let mapTab='net';
function renderMappings(){
  const nets = [
    { name:'网络映射 · prod 基线', src:'VM Network → pod · VLAN10 → nad-vlan10-prod · VLAN20 → nad-vlan20-mgmt', used:'pl-web, pl-db, pl-win', owner:'迁移组' },
    { name:'网络映射 · 管理网专用', src:'VM Network → pod · VLAN30 → nad-vlan30-backup', used:'pl-mw', owner:'迁移组' },
    { name:'网络映射 · RHV 旧平台', src:'ovirt-mgmt → pod · ovirt-tenant → nad-vlan10-prod', used:'pl-arch', owner:'平台组' },
  ];
  const stors = [
    { name:'存储映射 · 主数据映射', src:'ds-nvme-fc01 → ocs-ceph-rbd · ds-ssd-sata02 → ocs-ceph-rbd · ds-nas-archive → ceph-fs-shared', used:'pl-web, pl-db, pl-win', owner:'迁移组' },
    { name:'存储映射 · 归档专用', src:'ds-nas-archive → ceph-fs-shared', used:'pl-mw', owner:'迁移组' },
  ];
  const list = mapTab==='net'?nets:stors;
  $('[data-view="mappings"]').innerHTML=`
  <div class="view-head">
    <div><h1>映射配置</h1><p>网络与存储映射可复用于多个迁移计划，是迁移一致性的基础</p></div>
    <div class="actions">
      <div class="tabs"><button class="${mapTab==='net'?'on':''}" onclick="mapTab='net';renderMappings()">网络映射</button><button class="${mapTab==='stor'?'on':''}" onclick="mapTab='stor';renderMappings()">存储映射</button></div>
      <button class="btn btn-primary" onclick="toast('info','新建映射','推荐在迁移向导第 2/3 步中创建并自动保存到映射库（演示）')">${ic('bolt',14)} 新建映射</button>
    </div>
  </div>
  <div class="card">
    <table class="table">
      <thead><tr><th>名称</th><th>映射关系</th><th>引用计划</th><th>维护</th></tr></thead>
      <tbody>${list.map(m=>`<tr>
        <td><b>${m.name}</b></td>
        <td><span class="mono" style="font-size:11.5px;color:var(--text-1)">${m.src}</span></td>
        <td>${m.used}</td>
        <td style="color:var(--text-2)">${m.owner} · <button class="btn btn-ghost btn-sm" onclick="toast('ok','校验通过','所有目标网络/存储类均存在且健康')">校验</button></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>
  <div class="note info" style="margin-top:14px">${ic('info')}<div><b>映射与计划解耦</b><p>修改映射不会影响正在运行的迁移计划；新计划引用映射时将再次校验目标网络（NAD）与 StorageClass 的存在性和容量水位。</p></div></div>`;
}

/* ═══════════════ 渲染：历史 ═══════════════ */
function renderHistory(){
  const rows=[...HISTORY, ...PLANS.filter(p=>p.status==='done').map(p=>({name:p.name,vms:p.vms.length,ok:planVMsOk(p),fail:0,vol:'0.9 TB',win:'6m12s',end:'10-13 01:12',src:'vSphere'}))];
  $('[data-view="history"]').innerHTML=`
  <div class="view-head">
    <div><h1>迁移历史</h1><p>批次级迁移报告与切换窗口统计</p></div>
    <div class="actions"><button class="btn btn-ghost" onclick="exportReport()">${ic('file',14)} 导出全部报告</button></div>
  </div>
  <div class="stat-grid">
    <div class="stat-cell"><b>6 <em>个批次</em></b><small>累计完成计划</small></div>
    <div class="stat-cell"><b>112 <em>台</em></b><small>迁移虚拟机总数</small></div>
    <div class="stat-cell"><b>96.4<em>%</em></b><small>一次切换成功率</small></div>
    <div class="stat-cell"><b>7<small>min</small> 32<small>s</small></b><small>平均切换窗口</small></div>
    <div class="stat-cell"><b>84.2 <em>TB</em></b><small>累计迁移数据量</small></div>
  </div>
  <div class="card">
    <table class="table">
      <thead><tr><th>计划</th><th>源平台</th><th>虚拟机</th><th>成功 / 失败</th><th>数据量</th><th>切换窗口</th><th>完成时间</th><th>报告</th></tr></thead>
      <tbody>${rows.map(h=>`<tr>
        <td><b>${h.name}</b></td><td>${h.src}</td><td class="num">${h.vms}</td>
        <td><span style="color:var(--ok)">${h.ok}</span> / <span style="color:${h.fail?'var(--err)':'var(--text-2)'}">${h.fail}</span></td>
        <td class="num">${h.vol}</td><td class="num">${h.win}</td><td class="mono">${h.end}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="exportReport()">${ic('file',12)} PDF</button></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

/* ═══════════════ 渲染：设置 ═══════════════ */
const SETTINGS={ con:4, notify:true, autoSc:true, vddk:'registry.corp.local/forklift/vddk:8.0.3', transfer:'nad-migration-net' };
function renderSettings(){
  $('[data-view="settings"]').innerHTML=`
  <div class="view-head"><div><h1>系统设置</h1><p>Forklift Controller 全局参数（forkliftcontroller CR）</p></div></div>
  <div class="settings-grid">
    <div class="card">
      <div class="card-title">${ic('bolt')}迁移引擎</div>
      <div class="set-row"><div class="t"><b>并发迁移虚拟机数</b><small>每计划同时进行磁盘拷贝的 VM 上限</small></div>
        <select class="select" style="width:110px" onchange="SETTINGS.con=+this.value;toast('ok','已保存','并发度将热加载到 Controller')">
          ${[2,4,6,8].map(n=>`<option ${SETTINGS.con===n?'selected':''}>${n}</option>`).join('')}</select></div>
      <div class="set-row"><div class="t"><b>VDDK 传输镜像</b><small>vSphere 磁盘拷贝加速库</small></div>
        <input class="input mono" style="width:290px" value="${SETTINGS.vddk}" onchange="toast('ok','已更新','VDDK 镜像地址已保存')"></div>
      <div class="set-row"><div class="t"><b>专用迁移网络</b><small>磁盘传输使用的 Multus NAD</small></div>
        <input class="input mono" style="width:290px" value="${SETTINGS.transfer}" onchange="toast('ok','已更新','迁移网络已保存')"></div>
      <div class="set-row"><div class="t"><b>预热增量轮次上限</b><small>达到上限后建议尽快切换</small></div>
        <select class="select" style="width:110px"><option>12 轮</option><option>20 轮</option></select></div>
    </div>
    <div class="card">
      <div class="card-title">${ic('shield')}安全与通知</div>
      <div class="set-row"><div class="t"><b>切换前强制二次确认</b><small>割接操作需管理员确认</small></div>
        <button class="switch on" onclick="this.classList.toggle('on')"></button></div>
      <div class="set-row"><div class="t"><b>迁移完成通知</b><small>企业微信 / 邮件推送结果</small></div>
        <button class="switch ${SETTINGS.notify?'on':''}" onclick="this.classList.toggle('on')"></button></div>
      <div class="set-row"><div class="t"><b>失败自动回滚目标 VM</b><small>转换失败时清理目标端残留</small></div>
        <button class="switch on" onclick="this.classList.toggle('on')"></button></div>
      <div class="set-row"><div class="t"><b>自动推荐 StorageClass</b><small>按源 datastore 类型智能匹配</small></div>
        <button class="switch ${SETTINGS.autoSc?'on':''}" onclick="this.classList.toggle('on')"></button></div>
      <div class="set-row"><div class="t"><b>审计日志</b><small>所有操作写入审计（保留 180 天）</small></div>
        <button class="switch on" onclick="this.classList.toggle('on')"></button></div>
    </div>
  </div>`;
}

/* ═══════════════ 路由 ═══════════════ */
const CRUMBS={ dashboard:['总览'], wizard:['新建迁移'], plans:['迁移计划'], plan:['迁移计划','计划详情'], providers:['平台连接'], mappings:['映射配置'], history:['迁移历史'], settings:['系统设置'] };
function route(){
  const h=location.hash||'#/dashboard';
  const [_,page,arg]=h.split('/');
  const view=page||'dashboard';
  $$('.view').forEach(v=>v.classList.toggle('on', v.dataset.view===view||(view==='plan'&&v.dataset.view==='plan')));
  $$('#nav .nav-item').forEach(a=>a.classList.toggle('active', a.getAttribute('href')==='#/'+view));
  const c=CRUMBS[view]||['总览'];
  $('#crumb').innerHTML=c.map((x,i)=>`${i?'<span class="sep">/</span>':''}${i===c.length-1?`<b>${x}</b>`:x}`).join('');
  const pill=$('#nav-plans-badge');
  if(pill){ const n=PLANS.filter(p=>!['done'].includes(p.status)).length; pill.textContent=n; pill.style.display=n?'':'none'; }
  if(view==='dashboard') renderDashboard();
  if(view==='wizard'){ renderWizard(); if(S.wizard.step===6){ S.wizard.pfDone=false; startPreflight(); } }
  if(view==='plans') renderPlans();
  if(view==='plan') renderPlanDetail(arg);
  if(view==='providers') renderProviders();
  if(view==='mappings') renderMappings();
  if(view==='history') renderHistory();
  if(view==='settings') renderSettings();
  $('#views').scrollTop=0;
}
const go=h=>{ location.hash=h; };

/* ═══════════════ 模拟引擎 ═══════════════ */
function pushEvent(m){ EVENTS.unshift({t:now(),m}); S.notif++; $('#bell-dot').textContent=S.notif; }
let lastTickPct={};
function tick(){
  PLANS.forEach(p=>{
    if(p.status==='staging'){
      let active=0;
      p.vms.forEach(v=>{
        if(v.phase==='queued') v.phase='staging';
        if(v.phase==='staging'){
          active++;
          const rate=(120+Math.random()*260); // MB/s
          const delta=rate*22/(v.disk*10.24); // 演示速率：1× 下单台约 1~3 分钟完成预热
          v.progress=Math.min(100, v.progress+delta*(S.speed));
          if(v.progress>=100){ v.progress=100; v.phase='readyForCutover'; pushEvent(`<b>${v.name}</b> 预拷贝完成，等待切换`); }
        }
      });
      p.throughput=Math.round(active*(90+Math.random()*120));
      const allReady=p.vms.every(v=>['readyForCutover','succeeded','canceled'].includes(v.phase));
      if(allReady && p.vms.some(v=>v.phase==='readyForCutover')){
        p.status='ready'; p.throughput=0;
        pushEvent(`<b>${p.name}</b> 预热全部完成，进入待切换状态`);
        toast('ok','预热完成','计划「'+p.name+'」已就绪，可安排切换窗口');
      }
    }
    else if(p.status==='cutting'){
      let busy=p.vms.find(v=>v.phase==='cutover'||v.phase==='converting'||v.phase==='starting');
      if(busy){
        if(busy.phase==='cutover'){ busy.phase='converting'; }
        else if(busy.phase==='converting'){ busy.progress=Math.min(100,busy.progress+18*S.speed);
          if(busy.progress>=100){ busy.phase='starting'; pushEvent(`<b>${busy.name}</b> virt-v2v 转换完成，目标端拉起中`); } }
        else if(busy.phase==='starting'){ setTimeout(()=>{ if(busy.phase==='starting'){ busy.phase='succeeded'; busy.progress=100; pushEvent(`<b>${busy.name}</b> 已在 KubeVirt 上运行，健康检查通过`); } }, 900); }
      } else {
        p.status='done'; p.throughput=0;
        pushEvent(`<b>${p.name}</b> 切换窗口结束，批次迁移完成`);
        toast('ok','批次迁移完成','「'+p.name+'」全部虚拟机已在 KubeVirt 运行');
      }
    }
  });
  // 局部刷新（仅相关视图）
  const cur=location.hash;
  if(cur.startsWith('#/dashboard')) renderDashboard();
  else if(cur.startsWith('#/plan/')) renderPlanDetail(cur.split('/')[2]);
  else if(cur==='#/plans') renderPlans();
}
setInterval(tick, 1600);

/* ── 全局搜索 ── */
function initSearch(){
  const box=$('#global-search');
  document.addEventListener('keydown',e=>{
    if(e.key==='/'&&document.activeElement!==box){ e.preventDefault(); box.focus(); }
    if(e.key==='Escape'){ closeDrawer(); closeModal(); box.blur(); }
  });
  box.addEventListener('keydown',e=>{
    if(e.key!=='Enter') return;
    const q=box.value.trim(); if(!q) return;
    const vm=DATA.vmCatalog.find(v=>v.name.includes(q)||v.ip===q);
    const pl=PLANS.find(p=>p.name.includes(q)||p.id===q);
    const pv=DATA.providers.find(p=>p.name.includes(q));
    if(vm){ toast('info','已定位虚拟机',vm.name+' · '+vm.ip+' · 位于源平台清单'); location.hash='#/wizard'; S.wizard.step=4; renderWizard(); }
    else if(pl){ location.hash='#/plan/'+pl.id; toast('info','已打开计划',pl.name); }
    else if(pv){ location.hash='#/providers'; }
    else toast('err','未找到匹配','尝试虚拟机名称、IP、计划或平台关键词');
    box.value=''; box.blur();
  });
}
$('#bell-btn').addEventListener('click',()=>{ S.notif=0; $('#bell-dot').style.display='none'; toast('info','通知中心','3 条迁移动态已读，可在总览页查看事件流'); });
$('#speed-btn').addEventListener('click',()=>{ S.speed=S.speed===1?8:1; $('.speed-label').textContent=S.speed+'×'; $('#speed-btn').classList.toggle('on',S.speed>1); toast('info','演示速度',S.speed===1?'已恢复 1× 实时模拟':'已切换为 '+S.speed+'× 加速模拟'); });

/* ── 启动 ── */
window.addEventListener('hashchange',route);initSearch();
route();
