# 发票合并助手

发票合并助手是一款基于 React + TypeScript + Tauri 的跨平台桌面工具，用于将一个文件夹中的发票 PDF、图片（JPG/PNG/HEIC）快速合并为一个标准 PDF，适合报销、财务归档或客户资料整理等场景。所有数据都在本地处理，不会上传到云端。

![应用截图](docs/images/snapshot_v2.png)

## 核心特性

- **选择文件夹即用**：支持自动扫描目录，展示文件类型、大小、修改时间，并支持按文件名或修改时间排序。
- **多格式支持**：PDF 直接拼接，图片文件自动铺满 A4 页面；HEIC 依赖系统自带解码（macOS 原生支持）。
- **可选合并**：列表提供复选框，可灵活排除不需要合并的文件。
- **进度与反馈**：实时显示扫描/转换/合并/写入阶段，完成后弹窗提示失败数量。

## 快速开始

1. 安装依赖：`npm install`
2. 启动调试模式：
   ```bash
   npm run tauri dev
   ```
3. 构建正式版本（macOS/Windows/Linux 包）：
   ```bash
   npm run tauri build
   ```

> 注意：需要安装 Rust（stable）及对应平台的 Tauri 依赖。macOS 上建议安装 `brew install libheif pkg-config` 以确保 HEIC 转换。

## 目录结构

- `src/`：Vite + React 前端
- `src-tauri/`：Rust 后端与打包配置
- `docs/`：需求、设计、技术文档与截图
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
