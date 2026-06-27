# 发票合并助手

发票合并助手是一款基于 React + TypeScript 构建的发票整理工具，同时提供 Tauri 桌面版与纯浏览器 Web 版。它可以将一个文件夹中的发票 PDF 和图片快速合并为一个标准 PDF，适合报销、财务归档或客户资料整理等场景。所有数据都在本地处理，不会上传到云端。

![应用截图](docs/images/snapshot_v2.png)

## 核心特性

- **选择文件夹即用**：支持自动扫描目录，展示文件类型、大小、修改时间，并支持按文件名或修改时间排序。
- **本地隐私处理**：桌面版与 Web 版都在本地完成解析与合并，不依赖账号、后端或云存储。
- **多格式支持**：Web 版支持 PDF、JPG/JPEG、PNG、WebP、BMP、GIF（取首帧）；桌面版额外支持 HEIC、TIFF。
- **可选合并**：列表提供复选框，可灵活排除不需要合并的文件。
- **进度与反馈**：实时显示扫描/转换/合并/写入阶段，完成后弹窗提示失败数量。

## 快速开始

1. 安装依赖：`npm install`
2. 启动 Web 调试模式：
   ```bash
   npm run dev
   ```
3. 构建 Web 静态产物：
   ```bash
   npm run build
   ```
4. 启动桌面版调试模式：
   ```bash
   npm run tauri dev
   ```
5. 构建桌面正式版本（macOS/Windows/Linux 包）：
   ```bash
   npm run tauri build
   ```

> 注意：桌面版需要安装 Rust（stable）及对应平台的 Tauri 依赖。macOS 上建议安装 `brew install libheif pkg-config` 以确保 HEIC/TIFF 等桌面扩展格式转换正常。

## Web 版部署

Web 版可以直接部署到 Cloudflare Pages，构建设置如下：

- Build command: `npm run build`
- Output directory: `dist`
- Node.js: `20` 或更高版本
- 不需要任何 bindings、鉴权、数据库、对象存储或后端服务

更完整的 Web 使用与部署说明见 [README_WEB.md](README_WEB.md)。

## 目录结构

- `src/`：Vite + React 前端
- `src-tauri/`：Rust 后端与打包配置
- `docs/`：需求、设计、技术文档与截图
- `README_WEB.md`：Web 版本地运行与 Cloudflare Pages 部署说明
- `AGENTS.md`：贡献者指南

## CI / 发布

仓库包含 GitHub Actions 工作流（`.github/workflows/release.yml`），当推送 `v*` 标签或手动触发时，会自动构建 macOS 与 Windows 安装包并发布到 Release。

## macOS Gatekeeper 提示

若下载的 `.app/.dmg` 未签名，可在终端运行以下命令，解除 Gatekeeper 限制后再右键「打开」一次：

```bash
xattr -cr /Applications/InvoiceMergeAssistant.app
```

## 贡献

请参考 `AGENTS.md` 获取代码规范、测试与 PR 要求，欢迎提交 Issue / PR，一起完善更多文件格式支持与体验。 

## 请我喝杯咖啡
如果这个软件对你有用，可以请我喝杯咖啡，谢谢。

![请我喝杯咖啡](docs/images/pay_me_a_coffee.png)
