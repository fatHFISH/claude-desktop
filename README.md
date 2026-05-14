# Claude Desktop

一个基于 Claude API 的桌面客户端，支持文件读写、命令执行、代码搜索等工具能力。

## 功能

- 多轮对话，支持中文和英文
- 流式输出，逐字显示
- 工具调用（Tool Use）：读取/写入文件、执行命令、搜索代码、浏览目录
- 工具调用过程可视化
- Markdown 渲染 + 代码语法高亮
- 自定义 System Prompt
- 自定义 API Key / Base URL / 模型（支持第三方代理）
- 自由切换工作目录

## 快速开始

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- Anthropic API Key（[获取地址](https://console.anthropic.com/)）

### 安装

```bash
git clone https://github.com/fatHFISH/claude-desktop.git
cd claude-desktop
npm install
```

### 启动

**方式一：双击启动（推荐）**

双击 `Claude1.bat`，自动打开桌面客户端。

**方式二：命令行启动桌面版**

```bash
npm run app
```

**方式三：Web 版（浏览器）**

```bash
npm start
```

然后打开 `http://localhost:3000`

### 首次使用

1. 启动后点击右上角 ⚙ 设置
2. 填入你的 API Key
3. 如果使用第三方代理，填写 Base URL 和模型名
4. 点击左侧 ☰ 菜单，选择「切换目录」设定工作目录
5. 开始对话

API Key 仅存储在浏览器本地（localStorage），不会上传到任何服务器。

## 使用流程

### 日常使用

```
双击 Claude.bat → 首次设置 API Key → 选择工作目录 → 开始对话
```

### 工具能力

在对话中直接用自然语言描述需求，Claude 会自动调用工具：

| 你说 | Claude 做 |
|------|----------|
| 列出当前目录文件 | 调用 list_files |
| 读取 package.json | 调用 read_file |
| 帮我写一个 hello.py | 调用 write_file |
| 执行 npm test | 调用 run_command |
| 搜索包含 express 的文件 | 调用 search_files |

工具调用过程会在界面上实时展示，可展开查看详情。

### Git 工作流

修改代码后推送到 GitHub：

```bash
git add .                              # 暂存改动
git commit -m "描述你改了什么"           # 提交
git push                               # 推送到 GitHub
```

拉取最新代码：

```bash
git pull
```

## 项目结构

```
├── main.js           # Electron 主进程（桌面版）
├── server.js         # Express 后端（Web 版）
├── public/
│   └── index.html    # 前端界面
├── Claude.bat        # Windows 快捷启动
├── package.json
├── .gitignore
└── README.md
```

## 技术栈

- **前端：** 原生 HTML/CSS/JS + highlight.js
- **后端：** Express + @anthropic-ai/sdk
- **桌面：** Electron

## 许可证

MIT
