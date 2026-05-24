# Git + VitePress 个人博客搭建实战总结

> 日期：2026-05-24  
> 目标：从零搭建运维技术博客，实现"写完即发布"

---

## 一、环境准备

| 组件 | 版本 | 用途 |
|------|------|------|
| Windows | 10/11 | 开发环境 |
| VS Code | 最新版 | 编辑器 + Git 集成 |
| Git | 已安装 | 版本控制 |
| Node.js | v20 | VitePress 运行环境 |
| npm | 随 Node | 依赖管理 |

### 验证命令
```bash
git --version
node -v
npm -v
```

---

## 二、VitePress 博客搭建

### 1. 初始化项目
```bash
mkdir my-blog && cd my-blog
npm init -y
npm add -D vitepress
npx vitepress init
```

### 2. 目录结构
```
my-blog/
├── docs/
│   ├── .vitepress/
│   │   └── config.mts          # 站点配置
│   ├── index.md                # 首页
│   ├── linux/
│   │   ├── index.md            # 目录页
│   │   └── kernel.md           # Linux内核文章
│   ├── interview/
│   │   ├── index.md
│   │   └── *.pdf               # 面试题PDF
│   └── monitor/
│       └── index.md            # 占位
├── .github/
│   └── workflows/
│       └── deploy.yml          # CI/CD部署
├── auto-push.js                # 自动推送脚本
├── .gitignore
└── package.json
```

### 3. 关键配置文件

**package.json**
```json
{
  "name": "my-blog",
  "version": "1.0.0",
  "scripts": {
    "dev": "vitepress dev docs",
    "build": "vitepress build docs",
    "preview": "vitepress preview docs",
    "watch": "node auto-push.js"
  },
  "devDependencies": {
    "vitepress": "^1.6.4"
  }
}
```

**docs/.vitepress/config.mts**
```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '运维成长记',
  description: '个人运维技术博客',
  base: '/my-blog/',              // GitHub Pages路径修复

  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: 'Linux运维', link: '/linux/' },
      { text: '监控体系', link: '/monitor/' },
      { text: '面试笔记', link: '/interview/' }
    ],

    sidebar: {
      '/linux/': [
        {
          text: 'Linux系统',
          items: [
            { text: '内核深度知识点', link: '/linux/kernel' }
          ]
        }
      ],
      '/monitor/': [],
      '/interview/': []
    }
  }
})
```

---

## 三、Git 仓库管理

### 1. 初始化与关联远程
```bash
git init
git remote add origin https://github.com/SealerNum1/my-blog.git
git config user.name "你的名字"
git config user.email "你的邮箱"
```

### 2. 基础提交流程
```bash
git add .                       # 暂存所有改动
git commit -m "feat: 添加文章"   # 提交（规范message）
git push -u origin main         # 首次推送建立追踪
git push origin main            # 后续推送
```

### 3. 分支工作流
```bash
# 创建功能分支
git checkout -b feature/xxx

# 开发完成，合并到main
git checkout main
git merge feature/xxx
git push origin main

# 删除已合并分支
git branch -d feature/xxx
```

### 4. .gitignore配置
```
node_modules/
docs/.vitepress/dist/
docs/.vitepress/cache/
*.log
```

---

## 四、GitHub Actions 自动部署

### 1. 部署脚本 .github/workflows/deploy.yml
```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: docs/.vitepress/dist
          force_orphan: true
```

### 2. GitHub Pages 配置
- 仓库 Settings → Pages
- Source: `Deploy from a branch`
- Branch: `gh-pages` / `(root)`
- 保存后等待2-3分钟

### 3. 访问地址
```
https://sealernum1.github.io/my-blog/
```

---

## 五、自动推送脚本

### 1. auto-push.js 完整代码
```javascript
const { execSync } = require('child_process')
const fs = require('fs')

let timer = null
let hasChange = false
let changedFile = ''

function autoCommit() {
  if (!hasChange) return
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' })
    if (!status.trim()) {
      hasChange = false
      return
    }
    execSync('git add .')
    execSync('git commit -m "auto: 更新 ' + new Date().toLocaleString() + '"')
    execSync('git push origin main')

    const githubUrl = `https://github.com/SealerNum1/my-blog/blob/main/docs/${changedFile.replace(/\\/g, '/')}`
    console.log('✅ 自动推送成功', new Date().toLocaleTimeString())
    console.log('🔗 GitHub链接:', githubUrl)

    hasChange = false
    changedFile = ''
  } catch (e) {
    console.log('❌ 推送失败:', e.message)
  }
}

function watchDir(dir) {
  fs.watch(dir, { recursive: true }, (eventType, filename) => {
    if (filename && (filename.endsWith('.md') || filename.endsWith('.pdf'))) {
      console.log(`📝 文件变动: ${filename}`)
      changedFile = filename
      hasChange = true
      clearTimeout(timer)
      timer = setTimeout(autoCommit, 5000)
    }
  })
}

watchDir('docs')

setInterval(() => {
  if (hasChange) {
    console.log('⏰ 定时兜底提交触发')
    autoCommit()
  }
}, 30 * 60 * 1000)

console.log('👀 监控启动：文件变动5秒后提交，30分钟兜底')
console.log('📁 监控目录: docs/')
console.log('📄 监控类型: .md, .pdf')
```

### 2. 使用方式
```bash
# 终端1：本地预览
npm run dev

# 终端2：自动监控推送
npm run watch
```

### 3. 双层保险机制
| 触发方式 | 延迟 | 场景 |
|---------|------|------|
| 文件变动 | 5秒防抖 | 正常保存文章 |
| 定时兜底 | 30分钟 | 长时间编辑、网络波动 |

---

## 六、Git 命令参数速查

### 远程操作
| 命令 | 参数 | 作用 |
|------|------|------|
| `git remote` | `-v` | 查看远程仓库地址 |
| `git push` | `-u origin main` | 首次推送建立追踪 |
| `git push` | `--force` / `-f` | 强制推送（危险） |
| `git fetch` | `origin` | 下载远程更新不合并 |
| `git pull` | `origin main` | 拉取并合并 |

### 分支操作
| 命令 | 参数 | 作用 |
|------|------|------|
| `git checkout` | `-b feature/xxx` | 创建并切换分支 |
| `git branch` | `-a` | 显示所有分支 |
| `git branch` | `-d feature/xxx` | 删除已合并分支 |
| `git branch` | `-D feature/xxx` | 强制删除 |

### 提交操作
| 命令 | 参数 | 作用 |
|------|------|------|
| `git add` | `-p` | 交互式选择部分改动 |
| `git add` | `-A` | 添加所有变动含删除 |
| `git commit` | `--amend` | 修改最后一次提交 |
| `git commit` | `--no-edit` | 复用上次message |

### 查看与对比
| 命令 | 参数 | 作用 |
|------|------|------|
| `git log` | `--oneline` | 一行显示 |
| `git log` | `--graph` | 图形化分支 |
| `git diff` | `--cached` | 暂存区 vs 上次提交 |
| `git diff` | `HEAD~1` | 上次提交的改动 |

### 撤销与恢复
| 命令 | 参数 | 作用 |
|------|------|------|
| `git reset` | `--soft HEAD~1` | 撤销commit保留暂存 |
| `git reset` | `--mixed HEAD~1` | 撤销commit保留工作区 |
| `git reset` | `--hard HEAD~1` | 彻底丢弃（危险） |
| `git reflog` | | 查看HEAD移动记录 |

### 临时存储
| 命令 | 参数 | 作用 |
|------|------|------|
| `git stash` | `push -m "描述"` | 藏改动加描述 |
| `git stash` | `pop` | 恢复并删除 |
| `git stash` | `apply` | 恢复不删除 |
| `git stash` | `list` | 查看stash列表 |

---

## 七、Commit Message 规范

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat:` | 新功能 | `feat: 添加Nginx配置文章` |
| `fix:` | 修复bug | `fix: 修复首页链接404` |
| `docs:` | 文档更新 | `docs: 补充内核调优细节` |
| `style:` | 格式调整 | `style: 调整代码块缩进` |
| `refactor:` | 重构 | `refactor: 优化目录结构` |
| `chore:` | 杂项 | `chore: 更新依赖版本` |
| `ci:` | CI/CD | `ci: 添加GitHub Actions` |

---

## 八、成果清单

| 项目 | 状态 | 地址 |
|------|------|------|
| GitHub仓库 | ✅ | https://github.com/SealerNum1/my-blog |
| 线上博客 | ✅ | https://sealernum1.github.io/my-blog/ |
| Linux内核文章 | ✅ | docs/linux/kernel.md |
| 面试题PDF | ✅ | docs/interview/*.pdf (5个) |
| 自动推送 | ✅ | auto-push.js |
| CI/CD部署 | ✅ | GitHub Actions |

---

## 九、待加强技能

| 技能 | 命令 | 优先级 |
|------|------|--------|
| 整理提交历史 | `git rebase -i HEAD~N` | ⭐⭐⭐ |
| 临时存储切换 | `git stash` 全流程 | ⭐⭐⭐ |
| 找回丢失提交 | `git reflog` | ⭐⭐⭐ |
| 挑拣单次提交 | `git cherry-pick` | ⭐⭐ |
| 版本标签发布 | `git tag` | ⭐⭐ |
| PR冲突解决 | `git pull` + 手动解决 | ⭐⭐ |
| fork同步上游 | `git remote add upstream` | ⭐ |

---

## 十、面试话术

> "我搭了个人技术博客，用 VitePress 写 Markdown，通过 Git 分支管理文章开发。配置了 GitHub Actions 实现 push 即部署，还写了 Node.js 脚本做文件监控，实现保存后自动提交推送。整个流程覆盖了 Git 日常操作、CI/CD 配置和自动化脚本编写。"

---

> 整理时间：2026-05-24  
> 适用场景：运维/SRE 面试 / Git 学习复盘
