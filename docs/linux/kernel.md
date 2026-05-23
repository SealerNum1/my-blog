# Linux 系统深度知识点汇总

---

## 一、进程管理与调度测试001

### 1.1 进程生命周期与状态机
- **TASK_RUNNING**：可运行状态，但不一定在 CPU 上执行（取决于调度器）
- **TASK_INTERRUPTIBLE**：可中断睡眠，等待资源或信号唤醒
- **TASK_UNINTERRUPTIBLE（D 状态）**：不可中断睡眠，通常等待 I/O 完成，无法被信号打断，是生产环境"僵尸进程/卡死"的典型表现
- **TASK_STOPPED / TASK_TRACED**：被信号或调试器暂停
- **EXIT_ZOMBIE**：子进程已退出但父进程未 `wait()`，保留 PID 和退出状态
- **EXIT_DEAD**：父进程已回收，等待内核彻底释放

> 面试话术：D 状态进程常见于 NFS 挂死、磁盘故障、内核 bug，排查用 `echo w > /proc/sysrq-trigger` 看阻塞栈。

### 1.2 CFS 完全公平调度器（Completely Fair Scheduler）
- **vruntime（虚拟运行时间）**：`vruntime = 实际运行时间 * 1024 / 权重`，调度器每次选 vruntime 最小的进程运行
- **nice 值映射权重**：nice -20 到 19 对应权重 88761 到 15，nice 差 1 约 10% CPU 差异
- **调度延迟与最小粒度**：`sched_latency_ns`（默认 6ms）决定一个周期内所有可运行进程应至少运行一次；`sched_min_granularity_ns`（默认 0.75ms）保证单个进程最小运行时间
- **CPU 亲和性与 NUMA 感知**：`sched_setaffinity()`、`taskset`、`numactl`，避免跨 NUMA 节点内存访问带来的性能损耗

### 1.3 实时调度策略
- **SCHED_FIFO**：先到先服务，一旦抢占除非自己阻塞或被更高优先级抢占，否则一直运行
- **SCHED_RR**：时间片轮转，同优先级进程按时间片（默认 100ms）轮询
- **SCHED_DEADLINE**：基于 Earliest Deadline First，用于硬实时场景（内核 3.14+）

---

## 二、内存管理

### 2.1 虚拟内存与页表
- **四级页表（x86_64）**：PGD → PUD → PMD → PTE，CR3 寄存器指向当前进程 PGD
- **大页（HugePage）**：2MB / 1GB 大页减少 TLB miss，Oracle/MySQL 等数据库场景常用，`/proc/sys/vm/nr_hugepages`
- **TLB（Translation Lookaside Buffer）**：CPU 缓存最近使用的页表项，上下文切换时 TLB 刷新是性能瓶颈之一，PCID（Process Context ID）缓解此问题

### 2.2 内存分配器与碎片
- **SLAB / SLUB / SLOB**：
  - SLAB：早期内核，按对象类型缓存，减少碎片
  - SLUB：默认分配器，简化设计，更好的调试支持
  - SLOB：嵌入式场景，简单紧凑
- **伙伴系统（Buddy System）**：管理物理页框，按 2 的幂次分配，合并时向上归并，避免外部碎片
- **内存碎片指数**：`/proc/buddyinfo` 查看各阶空闲页数量，判断是否存在严重碎片

### 2.3 OOM Killer 机制
- **oom_score**：基于进程内存占用、运行时间、nice 值计算，分数越高越先被杀
- **oom_score_adj**：手动调整，`-1000` 表示永不杀，正值加速被杀
- **oom_kill_allocating_task**：是否直接杀触发 OOM 的进程（默认 0，按 oom_score 选择）
- **内核选择逻辑**：优先杀子进程多、内存占用大、运行时间短的进程，保护 init 和内核线程

> 面试话术：遇到 OOM，先看 `/var/log/messages` 或 `dmesg` 里的 OOM 日志，确认被杀进程和触发者，再调整 `vm.overcommit_memory` 和 `vm.overcommit_ratio`。

### 2.4 内存回收与 Swap
- **页回收策略**：LRU 链表（active/inactive），kswapd 后台异步回收，直接回收（direct reclaim）阻塞进程
- **swappiness**：0-100，倾向使用 swap 的程度，生产数据库通常设为 1 或 10
- **内存水位线**：min / low / high，低于 low 触发 kswapd，低于 min 触发直接回收
- **内存压缩（zRAM / zSwap）**：内存紧张时压缩页而非直接换出，减少磁盘 I/O

---

## 三、文件系统与 I/O

### 3.1 VFS 虚拟文件系统层
- **四大对象**：superblock（文件系统元数据）、inode（文件元数据）、dentry（目录项缓存）、file（打开文件描述符）
- **dentry cache（dcache）**：加速路径解析，`/proc/sys/fs/dentry-state` 查看状态
- **inode cache**：缓存 inode 结构，与 slab 关联

### 3.2 ext4 深度机制
- **Extents**：取代传统块映射，用起始块+长度描述连续区域，减少碎片和大文件元数据开销
- **延迟分配（Delayed Allocation）**：写操作先缓存，提交时才分配物理块，提高连续性和性能
- **日志模式**：
  - `data=writeback`：只日志元数据，最快但崩溃后数据可能不一致
  - `data=ordered`（默认）：元数据日志，数据先刷盘再日志元数据
  - `data=journal`：数据和元数据都日志，最安全但最慢
- **多块分配器（mballoc）**：一次性分配多个块，减少碎片
- **目录索引（dir_index）**：HTree 哈希索引，大目录（百万级文件）查找从 O(n) 降到 O(log n)

### 3.3 XFS 与生产场景
- **分配组（Allocation Groups）**：并行分配，适合高并发写入
- **延迟日志（Delayed Logging）**：批量提交日志，减少 I/O 放大
- ** reflink（COW）**：`cp --reflink`，共享数据块，修改时才复制，节省空间
- **适合场景**：大文件、高并发写、海量小文件不如 ext4

### 3.4 I/O 栈与调度
- **I/O 路径**：用户空间 → VFS → 页缓存 → 文件系统 → 块层 → I/O 调度器 → SCSI/SATA/NVMe 驱动 → 硬件
- **I/O 调度器**：
  - **CFQ（已废弃）**：按进程分队列，公平但高延迟
  - **Deadline**：读优先、防止饥饿，适合通用场景
  - **NOOP**：简单 FIFO，适合 SSD/NVMe（本身有 FTL 调度）
  - **MQ-DEADLINE / BFQ**：多队列场景，NVMe 默认 MQ-DEADLINE
- **Block MQ（Multi-Queue）**：每个 CPU 一个提交队列，硬件队列映射到设备队列，解决单队列锁竞争

### 3.5 页缓存与回写
- **页缓存（Page Cache）**：文件数据的内存缓存，读文件时优先从页缓存取
- **回写机制**：`dirty_expire_centisecs`（脏页过期时间，默认 30s）、`dirty_writeback_centisecs`（回写周期，默认 5s）、`dirty_ratio` / `dirty_background_ratio`（脏页占比阈值）
- **直接 I/O（O_DIRECT）**：绕过页缓存，数据库如 MySQL InnoDB 常用，需应用自己管理缓存
- **异步 I/O（AIO / io_uring）**：`io_uring`（内核 5.1+）通过共享环形缓冲区减少系统调用开销，性能远超 libaio

---

## 四、网络子系统

### 4.1 TCP/IP 协议栈内核实现
- **sk_buff（Socket Buffer）**：内核网络数据包的核心结构，包含数据指针、协议头、设备信息、引用计数
- **Netfilter 框架**：PREROUTING → INPUT/FORWARD → POSTROUTING → OUTPUT，iptables/nftables 基于此
- **连接跟踪（conntrack）**：`nf_conntrack` 模块记录连接状态，NAT 和状态防火墙依赖，表满时丢包
- **TCP 拥塞控制算法**：
  - **Cubic**（默认）：基于窗口增长曲线，适合高带宽延迟积网络
  - **BBR**（Google）：基于带宽和 RTT 建模，避免缓冲区膨胀，YouTube 大规模使用
  - **Reno / NewReno**：早期算法，简单但效率低
- **TCP 参数调优**：
  - `tcp_window_scaling`：启用窗口缩放，支持 >64KB 窗口
  - `tcp_timestamps` / `tcp_sack`：RTT 测量和选择性确认
  - `tcp_tw_reuse` / `tcp_tw_recycle`（已废弃）：TIME_WAIT 复用

### 4.2 网络命名空间与虚拟化
- **Network Namespace**：隔离网络设备、IP、路由、iptables，Docker 容器基础
- **veth pair**：成对虚拟网卡，一端在容器 ns，一端在宿主机 bridge
- **bridge / ovs**：二层转发，ovs 支持 OpenFlow、VXLAN、GRE 隧道
- **iptables vs nftables**：nftables 统一 IPv4/IPv6，性能更好，规则集更紧凑

### 4.3 eBPF 与 XDP
- **eBPF**：内核字节码虚拟机，安全运行用户定义代码，用于跟踪、过滤、负载均衡
- **XDP（eXpress Data Path）**：网卡驱动层直接处理数据包，DPDK 的轻量替代，DDoS 清洗、负载均衡场景
- **BPF Map**：内核与用户空间共享的键值存储，用于状态传递

---

## 五、内核机制与系统调用

### 5.1 系统调用深度
- **系统调用号**：x86_64 通过 `syscall` 指令进入内核，`rax` 存放调用号，`rdi/rsi/rdx` 传参
- **系统调用表**：`sys_call_table`，内核 5.x 后不再导出，rootkit 常篡改此处做钩子
- **vsyscall / vDSO**：用户空间快速获取时间、getcpu 等，避免真实系统调用开销
- **seccomp**：限制进程可使用的系统调用，Chrome 沙箱、Docker 默认启用

### 5.2 内核同步机制
- **自旋锁（spinlock）**：忙等待，适合短临界区，中断上下文可用，多核竞争时性能差
- **互斥锁（mutex）**：睡眠等待，适合长临界区，不可用于中断上下文
- **读写锁（rwlock / rwsem）**：读共享写独占，`seqlock` 用于读多写少且无读者阻塞场景（jiffies）
- **RCU（Read-Copy-Update）**：读无锁、写时复制，适合读极多写极少场景（路由表、链表遍历）
- **per-CPU 变量**：每个 CPU 独立副本，避免缓存伪共享（cache line bouncing）

### 5.3 中断与软中断
- **硬中断（IRQ）**：硬件触发，顶半部（top half）快速处理，关中断执行
- **软中断（softirq）**：底半部（bottom half），开中断执行，不可睡眠，同类型软中断可在多 CPU 并行
- **tasklet**：基于软中断，同类型不可并行，不同类可并行
- **workqueue**：基于内核线程，可睡眠，适合复杂或需阻塞的异步处理
- **NAPI**：网卡中断 + 轮询混合，高流量时切换轮询减少中断风暴

---

## 六、容器与 cgroups

### 6.1 cgroups v1 vs v2
- **v1**：各子系统独立挂载（cpu、memory、blkio、pids 等），存在竞争和一致性问题
- **v2**：统一层级，支持线程级控制，eBPF 集成，RHEL 8+/Ubuntu 22.04 默认
- **关键控制器**：
  - **cpu**：`cpu.shares`（权重）、`cpu.cfs_quota_us`（硬限制）、`cpu.uclamp.min/max`（性能边界）
  - **memory**：`memory.limit_in_bytes`、`memory.swappiness`、`memory.oom_control`
  - **blkio**：`blkio.throttle.read_bps_device`（限速）、权重控制（CFQ 时代有效，MQ 时代弱化）
  - **pids**：防止 fork 炸弹

### 6.2 Namespace 全家桶
- **PID ns**：独立进程空间，PID 1 为 init，孤儿进程由其收养
- **Mount ns**：独立挂载点，`/proc` 和 `/sys` 需重新挂载
- **UTS ns**：独立 hostname
- **IPC ns**：独立 IPC 资源（消息队列、共享内存）
- **User ns**：UID/GID 映射，rootless 容器基础
- **Cgroup ns**：隐藏真实 cgroup 路径
- **Time ns**：独立系统时间（内核 5.6+）

### 6.3 容器文件系统
- **OverlayFS**：lowerdir（只读镜像层）+ upperdir（可写容器层）+ workdir + merged，写时复制（COW）
- **问题**：大量小文件写操作导致 copy_up 性能差，`inode` 耗尽
- **替代**：ZFS/Btrfs 原生快照，LVM 快照，但 OverlayFS 仍是 Docker 默认

---

## 七、性能分析与调优

### 7.1 性能分析方法论
- **USE 法**：Utilization（利用率）、Saturation（饱和度）、Errors（错误），快速定位瓶颈
- **RED 法**：Rate（请求率）、Errors（错误率）、Duration（延迟），微服务场景
- **Off-CPU 分析**：进程不在 CPU 上时在等什么（锁、I/O、睡眠），用 `eBPF/offcputime` 分析

### 7.2 深入工具链
- **perf**：硬件 PMU（Performance Monitoring Unit）事件，`perf top` 热点、`perf record/report` 火焰图、`perf stat` 计数器
- **eBPF/BCC**：`execsnoop`（跟踪进程创建）、`opensnoop`（跟踪文件打开）、`biosnoop`（块 I/O 跟踪）、`tcpconnect`（TCP 连接跟踪）
- **ftrace**：内核内置跟踪器，`trace-cmd`、`kernelshark` 可视化
- **SystemTap**：动态插桩，需调试信息，功能强大但较重
- **LTTng**：用户空间+内核空间低延迟跟踪

### 7.3 火焰图解读
- **on-CPU 火焰图**：宽 = 采样次数多 = CPU 占用高，从下往上是调用栈
- **off-CPU 火焰图**：看阻塞在哪里（系统调用、锁等待、I/O）
- **内存火焰图**：看分配热点，定位内存泄漏或高分配压力

---

## 八、安全机制

### 8.1 Linux 安全模块（LSM）
- **SELinux**：强制访问控制（MAC），基于类型强制（TE）、角色、多级安全（MLS），策略复杂但粒度极细
- **AppArmor**：基于路径的 MAC，配置简单，Ubuntu 默认
- **Capabilities**：拆分 root 权限，`CAP_NET_ADMIN`、`CAP_SYS_PTRACE` 等，Docker `--cap-drop/add`
- **Seccomp-BPF**：系统调用过滤，Docker 默认白名单约 44 个调用

### 8.2 内核安全特性
- **KASLR**：内核地址空间布局随机化，防止 ROP 攻击
- **SMAP/SMEP**：用户空间数据/代码不可被内核直接访问/执行
- **Stack Protector（Canary）**：栈溢出检测
- **Control-Flow Integrity（CFI）**：间接调用检查，防止控制流劫持
- **Landlock**：非特权沙箱，应用自主限制文件访问（内核 5.13+）

---

## 九、系统启动与初始化

### 9.1 启动流程（x86_64）
1. **BIOS/UEFI**：硬件自检，加载 Bootloader
2. **GRUB2**：读取 `/boot/grub2/grub.cfg`，加载内核（vmlinuz）和 initramfs（initrd）
3. **内核解压**：`startup_64()` 入口，初始化页表、内存、中断、调度器
4. **initramfs**：临时根文件系统，加载必要驱动（磁盘控制器、文件系统模块），执行 `/init`
5. **systemd**：PID 1，`systemd` 解析 `/etc/systemd/system/default.target`，并行启动服务

### 9.2 systemd 深度
- **Unit 类型**：service、socket、target、device、mount、timer、slice、scope
- **依赖关系**：`Requires`（强依赖）、`Wants`（弱依赖）、`After/Before`（启动顺序）、`Conflicts`（互斥）
- **Slice 与 Cgroup**：`system.slice`（系统服务）、`user.slice`（用户会话）、`machine.slice`（容器/VM），自动创建 cgroup 树
- **Timer 替代 cron**：`OnCalendar`、`OnBootSec`、`OnUnitActiveSec`，支持持久化（`Persistent=true`）
- **Socket 激活**：`systemd.socket` 监听端口，请求来时启动服务，实现按需启动和故障恢复

---

## 十、故障排查与生产实战

### 10.1 系统无响应排查
1. **SysRq 魔术键**：`echo 1 > /proc/sys/kernel/sysrq`，`Alt+SysRq+w` 看阻塞任务，`Alt+SysRq+t` 打印所有任务栈
2. **kdump + crash**：内核崩溃时捕获 vmcore，用 `crash` 工具分析 `sys`、`bt`、`runq` 等
3. ** hung task 检测**：`kernel.hung_task_timeout_secs`（默认 120s），超时打印栈并可选 panic
4. **soft lockup / hard lockup**：看门狗检测，`softlockup_panic`、`nmi_watchdog`

### 10.2 内存泄漏排查
- **slabtop**：看内核对象分配，哪个 slab 持续增长
- **kmemleak**：内核内存泄漏检测器，编译时开启 `CONFIG_DEBUG_KMEMLEAK`
- **valgrind / memcheck**：用户空间内存泄漏
- **pmap / smaps**：查看进程内存映射，`Pss`（比例集大小）更准确反映实际占用

### 10.3 磁盘故障与文件系统修复
- **smartctl**：`smartctl -a /dev/sda` 看磁盘健康，关注 Reallocated_Sector_Ct、Current_Pending_Sector
- **badblocks**：破坏性/非破坏性检测
- **fsck 时机**：必须卸载或只读挂载，ext4 用 `e2fsck -y /dev/sda1`，XFS 用 `xfs_repair`（需先 `xfs_metadump` 备份）
- **日志恢复**：ext4 的 journal 可 `tune2fs -O ^has_journal` 临时关闭再修复，风险高

### 10.4 网络故障排查
- **连接状态分析**：`ss -tanioe` 看 TCP 内部信息（rto、ato、cwnd、ssthresh）
- **丢包定位**：`ethtool -S eth0` 看网卡统计（rx_missed_errors、rx_fifo_errors），`netstat -s` 看协议层丢包
- **路由追踪**：`mtr` 结合 `ping` 和 `traceroute`，实时看丢包和延迟
- **TCP 抓包分析**：`tcpdump -w file.pcap` + `Wireshark` 分析重传、乱序、窗口变化

---

## 十一、内核编译与定制

### 11.1 编译流程
```bash
# 获取源码
wget https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.8.tar.xz
tar xf linux-6.8.tar.xz
cd linux-6.8

# 配置
make menuconfig          # 图形化配置
# 或基于当前配置
cp /boot/config-$(uname -r) .config
make olddefconfig        # 新选项用默认值

# 编译
make -j$(nproc)
make modules_install
make install             # 更新 grub
```

### 11.2 关键配置项
- **CONFIG_PREEMPT_NONE/VOLUNTARY/FULL**：抢占模式，桌面选 FULL，服务器选 VOLUNTARY 或 NONE
- **CONFIG_HZ**：时钟中断频率，100（服务器，减少开销）/ 250 / 300 / 1000（桌面，低延迟）
- **CONFIG_CGROUPS / CONFIG_NAMESPACES**：容器支持
- **CONFIG_DEBUG_KERNEL / CONFIG_KGDB**：调试支持
- **CONFIG_LIVEPATCH**：热补丁，不重启更新内核（kpatch）

### 11.3 内核模块管理
- **模块依赖**：`depmod` 生成 `modules.dep`，`modprobe` 自动解决依赖，`insmod` 不解决
- **模块参数**：`/sys/module/<name>/parameters/`，`modprobe kvm_intel nested=1`
- **黑名单**：`/etc/modprobe.d/blacklist.conf`，`blacklist nouveau`
- **DKMS**：动态内核模块支持，NVIDIA 驱动、VirtualBox Guest Additions 等自动重编译

---

> 整理时间：2026-05-23
> 适用场景：高级运维 / SRE / 内核开发面试 / 生产故障排查
