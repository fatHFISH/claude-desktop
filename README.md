# Claude Desktop

一个基于 Claude API 的桌面客户端，支持文件读写、命令执行、代码搜索等工具能力。

## 功能

- 多轮对话，支持中文和英文
- 流式输出，逐字显示
- 工具调用（Tool Use）：读取/写入文件、执行命令、搜索代码、浏览目录
- 工具调用过程可视化
- Markdown 渲染 + 代码语法高亮
- 支持自定义 System Prompt
- 支持第三方 API 代理

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- Anthropic API Key（[获取地址](https://console.anthropic.com/)）

### 安装

```bash
git clone https://github.com/yourname/claude-desktop.git
cd claude-desktop
npm install
```

### 运行

**Web 版（浏览器）：**

```bash
npm start
```

然后打开 `http://localhost:3000`

**桌面应用（Electron）：**

```bash
npm run app
```

或双击 `Claude.bat`（Windows）

### 配置 API Key

1. 启动应用后点击右上角 ⚙ 设置
2. 填入你的 API Key
3. 如果使用第三方代理，填写 Base URL
4. 保存即可

API Key 仅存储在浏览器本地（localStorage），不会上传到任何服务器。

## 项目结构

```
├── main.js           # Electron 主进程
├── server.js         # Express 后端（Web 版）
├── public/
│   └── index.html    # 前端界面
├── Claude.bat        # Windows 快捷启动
├── package.json
└── README.md
```

## 技术栈

- **前端：** 原生 HTML/CSS/JS + highlight.js
- **后端：** Express + @anthropic-ai/sdk
- **桌面：** Electron

## 许可证

MIT
