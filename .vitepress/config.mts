import { defineConfig } from 'vitepress'

export default defineConfig({
  title: '运维成长记',
  description: '个人运维技术博客',
  
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: 'Linux运维', link: '/linux/kernel' }
    ],
    
    sidebar: {
      '/linux/': [
        {
          text: 'Linux系统',
          items: [
            { text: '内核深度知识点', link: '/linux/kernel' }
          ]
        }
      ]
    }
  }
})