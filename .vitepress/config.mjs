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
      { text: '编程', items: [
        { text: 'C++', link: '/cpp/async/threadsafe-lookup-table' },
        { text: 'Linux', link: '/cpp/Linux/ls' },
      ] },
      { text: '英语', link: '/markdown-examples' }
    ],

    sidebar: {
      // 1. Linux 专属侧边栏（匹配 /cpp/Linux/ 开头的路径）
      '/cpp/Linux/': [
        {
          text: 'Linux命令',
          collapsed: true, // 开启折叠按钮，且默认收起
          items: [
            { text: 'ls', link: '/cpp/Linux/ls' },
            { text: 'grep', link: '/cpp/Linux/grep' },
            { text: 'mkdir', link: '/cpp/Linux/mkdir' },
            { text: 'ls_gpt', link: '/cpp/Linux/ls_gpt' },
            { text: 'mkdir_gpt', link: '/cpp/Linux/mkdir_gpt' }
          ]
        }
      ],

      // 2. C++ 专属侧边栏（匹配 /cpp/ 下的其他路径）
      '/cpp/': [
        {
          text: 'STL',
          collapsed: true, // 开启折叠按钮，且默认收起
          items: [
            { text: 'Vector', link: '/cpp/STL/c_stl_std_vector' },
            { text: 'Vector_gpt', link: '/cpp/STL/Vector_STL_gpt' }
          ]
        },
        {
          text: '模板',
          collapsed: true, // 开启折叠按钮，且默认收起
          items: [
            { text: '模板的实例化和具体化', link: '/cpp/Template/cpp-template-instantiation-specialization_gpt' },
            { text: '模板的实例化和具体化2', link: '/cpp/Template/c' }
          ]
        },
        {
          text: '并发编程',
          collapsed: true, // 开启折叠按钮，且默认收起
          items: [
            { text: '[16]线程安全的查找表', link: '/cpp/async/threadsafe-lookup-table' },
            { text: '[17]线程安全的链表', link: '/cpp/async/code_artifact' },
            { text: '[18]无锁并发栈(延迟链表)', link: '/cpp/async/18_safe_stack' },
            { text: '[19]无锁并发栈(风险指针)', link: '/cpp/async/19_hazard_pointers' }
          ]
        }
      ],

      // 3. 根目录示例/英语页面的默认侧边栏
      '/': [
        {
          text: 'Examples',
          items: [
            { text: 'Markdown 演示2', link: '/markdown-examples' },
            { text: 'Runtime API 演示2', link: '/api-examples' }
          ]
        }
      ]
    },

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
