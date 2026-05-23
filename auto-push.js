const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

let timer = null
let hasChange = false

function autoCommit() {
  if (!hasChange) return
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8' })
    if (!status.trim()) {
      hasChange = false
      return
    }
    execSync('git add .')
    execSync('git commit -m "auto: 文章更新 ' + new Date().toLocaleString() + '"')
    execSync('git push origin main')
    console.log('✅ 自动推送成功', new Date().toLocaleTimeString())
    hasChange = false
  } catch (e) {
    console.log('❌ 推送失败:', e.message)
  }
}

function watchDir(dir) {
  fs.watch(dir, { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.md')) {
      console.log(`📝 文件变动: ${filename}`)
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