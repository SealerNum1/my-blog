# Docker 环境下 HAProxy + Nginx + Tomcat 三层架构部署实验

## 一、实验架构概述

### 1.1 架构分层设计

| 层级 | 容器 | 职责 | 网络 | 端口 |
|------|------|------|------|------|
| **入口层** | HAProxy | 负载均衡、动静分离、健康检查 | frontend + backend | 80（对外）、8404（监控） |
| **静态层** | Nginx | 静态资源服务、缓存、压缩 | frontend + backend | 80（对内） |
| **动态层** | Tomcat × 2 | JSP/Servlet 业务处理 | backend | 8080（对内） |

### 1.2 流量路径

```
用户请求 → HAProxy:80
    │
    ├─ 静态资源（.html/.css/.js）→ Nginx:80 → 直接返回
    │
    └─ 动态请求（.jsp/.do）→ Tomcat1:8080 / Tomcat2:8080（轮询）
```

### 1.3 网络隔离设计

- **frontend 网络**：HAProxy 和 Nginx 对外暴露
- **backend 网络**：Tomcat 仅内部通信，不直接暴露
- 安全优势：Tomcat 必须通过 HAProxy/Nginx 访问，后续加 Redis/MySQL 继续挂 backend 网络

---

## 二、核心配置文件详解

### 2.1 docker-compose.yml

```yaml
version: '3.8'

services:
  tomcat1:
    image: tomcat:9.0-jdk8
    container_name: tomcat1
    volumes:
      - ./tomcat/index1.jsp:/usr/local/tomcat/webapps/ROOT/index.jsp
    networks:
      - backend

  tomcat2:
    image: tomcat:9.0-jdk8
    container_name: tomcat2
    volumes:
      - ./tomcat/index2.jsp:/usr/local/tomcat/webapps/ROOT/index.jsp
    networks:
      - backend

  nginx:
    image: nginx:alpine
    container_name: nginx
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf
      - ./nginx/html:/usr/share/nginx/html
    networks:
      - backend
      - frontend
    depends_on:
      - tomcat1
      - tomcat2

  haproxy:
    image: haproxy:alpine
    container_name: haproxy
    ports:
      - "80:80"
      - "8404:8404"
    volumes:
      - ./haproxy/haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro
    networks:
      - frontend
      - backend
    depends_on:
      - nginx
      - tomcat1
      - tomcat2

networks:
  frontend:
  backend:
```

**关键点：**
- `depends_on` 控制启动顺序：Tomcat → Nginx → HAProxy
- `volumes` 挂载配置文件，无需重建镜像即可修改
- `networks` 实现服务间通信隔离
- `ports` 仅暴露 HAProxy 的 80 和 8404，其他服务不直接对外

---

### 2.2 HAProxy 配置（haproxy.cfg）

```haproxy
global
    maxconn 4096          # 最大并发连接数
    daemon                # 后台运行

defaults
    mode http             # 工作在 HTTP 模式（L7 负载均衡）
    timeout connect 5s    # 连接超时
    timeout client 30s    # 客户端超时
    timeout server 30s    # 服务端超时

# 统计监控页面
listen stats
    bind *:8404
    stats enable
    stats uri /stats
    stats auth admin:admin

# 前端入口
frontend web_front
    bind *:80

    # ACL 规则：匹配静态文件后缀
    acl is_static path_end .html .css .js .png .jpg .gif .ico
    acl is_static path_beg /static /images

    # ACL 规则：匹配动态请求后缀
    acl is_dynamic path_end .jsp .do .action

    # 动静分离：根据 ACL 分发到不同后端
    use_backend nginx_static if is_static
    use_backend tomcat_dynamic if is_dynamic

    # 默认走 Nginx（首页等）
    default_backend nginx_static

# 静态资源后端：Nginx
backend nginx_static
    balance roundrobin    # 轮询算法
    server nginx nginx:80 check

# 动态请求后端：Tomcat 集群
backend tomcat_dynamic
    balance roundrobin
    option httpchk GET /index.jsp    # L7 健康检查
    server tomcat1 tomcat1:8080 check
    server tomcat2 tomcat2:8080 check
```

**核心配置详解：**

| 配置项 | 作用 |
|--------|------|
| `acl is_static` | 基于 URL 路径匹配静态资源请求 |
| `acl is_dynamic` | 基于 URL 路径匹配动态资源请求 |
| `use_backend ... if ...` | 条件路由，实现动静分离 |
| `balance roundrobin` | 轮询算法，均匀分发请求 |
| `option httpchk` | 第 7 层 HTTP 健康检查 |
| `check` | 后端服务器启用健康检测 |

---

### 2.3 Nginx 配置（default.conf）

```nginx
upstream tomcat_cluster {
    server tomcat1:8080 weight=1;
    server tomcat2:8080 weight=1;
}

server {
    listen 80;
    server_name localhost;

    # 静态文件直接由 Nginx 处理
    location ~* \.(html|css|js|png|jpg|gif|ico)$ {
        root /usr/share/nginx/html;
        expires 7d;           # 缓存 7 天
        access_log off;       # 关闭静态资源访问日志
    }

    # 动态请求透传给 Tomcat
    location ~ \.(jsp|do)$ {
        proxy_pass http://tomcat_cluster;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 默认首页
    location / {
        root /usr/share/nginx/html;
        index index.html;
    }
}
```

**核心配置详解：**

| 配置项 | 作用 |
|--------|------|
| `upstream tomcat_cluster` | 定义 Tomcat 后端集群 |
| `location ~* \.(html...)$` | 正则匹配静态资源，Nginx 直接响应 |
| `expires 7d` | 静态资源缓存 7 天，减少重复请求 |
| `proxy_pass` | 反向代理到 Tomcat 集群 |
| `proxy_set_header` | 透传原始请求头，保留客户端 IP |

---

### 2.4 Tomcat JSP 页面（区分实例）

**index1.jsp（Tomcat-1）：**
```jsp
<%@ page contentType="text/html; charset=UTF-8" language="java" %>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Tomcat-1</title>
</head>
<body>
    <h1>Server: Tomcat-1</h1>
    <p>当前时间: <%= new java.util.Date() %></p>
</body>
</html>
```

**index2.jsp（Tomcat-2）：**
```jsp
<%@ page contentType="text/html; charset=UTF-8" language="java" %>
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Tomcat-2</title>
</head>
<body>
    <h1>Server: Tomcat-2</h1>
    <p>当前时间: <%= new java.util.Date() %></p>
</body>
</html>
```

---

## 三、实验步骤

### 3.1 环境准备

```bash
# Ubuntu 新环境初始化
sudo apt update && sudo apt install -y docker.io docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
newgrp docker
```

### 3.2 项目部署

```bash
cd ~
# 下载并解压项目文件
unzip docker-site.zip
cd docker-site

# 拉取镜像（防止网络超时）
docker pull tomcat:9.0-jdk8
docker pull nginx:alpine
docker pull haproxy:alpine

# 启动容器
docker-compose up -d

# 查看状态
docker-compose ps
```

### 3.3 验证测试

| 验证项 | 命令/操作 | 预期结果 |
|--------|-----------|----------|
| 静态资源走 Nginx | `curl http://localhost/index.html` | 显示 Nginx 静态页面 |
| 动态请求轮询 Tomcat | `for i in {1..3}; do curl -s http://localhost/index.jsp \| grep "Server:"; done` | 交替显示 Tomcat-1 / Tomcat-2 |
| HAProxy 监控面板 | 浏览器访问 `http://<IP>:8404/stats` | admin/admin 查看后端状态 |
| 健康检查 | `docker logs haproxy` | 显示 L7OK/200 检查通过 |

---

## 四、疑难点问题与解决方案

### 4.1 问题一：静态页面中文乱码

**现象：** 访问 `index.html` 时中文显示为乱码（如 `钸 杩欐槸 Nginx 闈欐€侀〉`）

**原因：** HTML 文件缺少 `<meta charset="UTF-8">` 声明，浏览器使用默认编码（GBK）解析

**解决：**
```html
<head>
    <meta charset="UTF-8">
    <title>静态页面 - Nginx</title>
</head>
```

**预防：** Nginx 全局配置添加 `charset utf-8;`

---

### 4.2 问题二：JSP 页面中文乱码

**现象：** Tomcat 返回的 JSP 页面中文乱码

**原因：** JSP 文件头缺少 `charset=UTF-8` 声明

**解决：**
```jsp
<%@ page contentType="text/html; charset=UTF-8" language="java" %>
<html>
<head>
    <meta charset="UTF-8">
</head>
```

---

### 4.3 问题三：Tomcat 容器无法进入

**现象：** `docker exec -it tomcat1 /bin/bash` 报错 `no such file or directory`

**原因：** Tomcat 镜像基于 Alpine Linux，默认没有 bash

**解决：** 使用 `sh` 替代 `bash`
```bash
docker exec -it tomcat1 /bin/sh
```

---

### 4.4 问题四：HAProxy 健康检查失败

**现象：** Stats 页面显示 Tomcat 节点为 DOWN

**排查：**
```bash
# 查看 HAProxy 日志
docker logs haproxy

# 手动测试健康检查端点
docker exec -it haproxy curl -I http://tomcat1:8080/index.jsp

# 检查 Tomcat 是否启动完成
docker logs tomcat1
```

**常见原因：**
- Tomcat 启动慢，健康检查超时 → 增加 `timeout check` 时间
- JSP 文件未正确挂载 → 检查 volumes 路径

---

### 4.5 问题五：Nginx 反向代理 502 错误

**现象：** 访问 JSP 页面返回 502 Bad Gateway

**排查：**
```bash
# 检查 upstream 连通性
docker exec -it nginx ping -c 2 tomcat1

# 检查 Tomcat 端口监听
docker exec -it tomcat1 netstat -tlnp

# 查看 Nginx 错误日志
docker exec -it nginx cat /var/log/nginx/error.log
```

**常见原因：**
- Tomcat 未启动完成 → 等待或检查 depends_on
- 网络不通 → 检查 docker-compose networks 配置

---

## 五、面试话术总结

> "这个架构实现了三层解耦：
> 
> 1. **HAProxy** 做入口负载均衡和动静分离，通过 ACL 规则将静态请求分发到 Nginx，动态请求分发到 Tomcat 集群
> 2. **Nginx** 处理静态缓存和压缩，配置 `expires 7d` 减少重复请求，同时作为 Tomcat 的反向代理备用
> 3. **Tomcat** 专注动态业务处理，双节点通过 `balance roundrobin` 轮询分担负载
> 
> Docker Compose 网络隔离了 frontend/backend，Tomcat 不直接暴露，提升了安全性。HAProxy 的 `option httpchk` 实现第 7 层健康检查，自动剔除故障节点。"

---

## 六、扩展方向

| 扩展 | 实现方式 |
|------|----------|
| Session 共享 | 引入 Redis，配置 Tomcat session 持久化 |
| 高可用 | Keepalived + VIP，双 HAProxy 主备 |
| SSL 终止 | HAProxy 配置 `bind *:443 ssl crt ...` |
| 日志集中 | ELK 或 Loki 收集各容器日志 |
| 自动扩缩容 | Kubernetes + HPA 替代 Docker Compose |
