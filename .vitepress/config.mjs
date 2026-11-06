import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: '/docs_demo/', // <-- 加上这一行！前后都要带斜杠
  title: "过程集",
  description: "A VitePress Site",
  themeConfig: {
    outlineTitle: "快速定位",
    outline: [2,6],
    logo: {
      src: '/logo.png',
      alt: 'Logo'
    },
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: '家', items: [
        {text: 'C++的', link: 'cpp/async/threadsafe-lookup-table'},
        {text: '下拉下拉', link: '/'},
      ] },
      { text: '事例', link: '/markdown-examples' }
    ],

    sidebar: [
      {
        text: '并发编程',
        items: [
          { text: '[16]线程安全的查找表', link: '/home/ycx/Objects/docs_demo/cpp/async/threadsafe-lookup-table' },
          { text: '[17]线程安全的链表', link: '/api-examples' },
          { text: '[18]线程安全无锁并发栈', link: '/api-examples' }

        ]
      },
      {
        text: 'Examples',
        items: [
          { text: 'Markdown 演示2', link: '/markdown-examples' },
          { text: 'Runtime API 演示2', link: '/api-examples' }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/copy-kakaxi' }
    ],
    footer: {
        message: '基于 MIT 协议发布',
        copyright: 'Copyright © 2026 ycx'
    },
    search: {
      provider: "local",
      options: {
        translations: {
          button: {
            buttonText: "搜索文档",
            buttonAriaLabel: "搜索文档",
          },
          modal: {
            noResultsText: "无法找到相关结果",
            resetButtonTitle: "清除查询条件",
            footer: {
              selectText: "选择",
              navigateText: "切换",
            },
          },
        },
      },
    },
  },
})
