
# 发票合并工具 · 技术文档（Tauri 版本）

## 1. 总体架构

采用 Tauri 典型结构：

- **前端（/src）**
  - 技术栈：建议 React + TypeScript + Vite
  - 负责 UI：目录选择、文件列表展示、排序选项、进度条、结果提示
  - 调用 Tauri Command 执行合并任务

- **后端（/src-tauri）**
  - 使用 Rust 实现：
    - 扫描文件夹
    - 对图片（含 HEIC）进行解码与 PDF 化
    - 对多份 PDF 进行合并
    - 写出最终 PDF 文件
  - 对前端通过 `tauri::command` 暴露接口

整体调用链：

```text
React UI → invoke("scan_folder", folder_path) → Rust 扫描并返回文件列表
React UI → invoke("merge_invoices", params) → Rust 执行合并，返回结果
```

## 2. 目录结构（简化版）

```text
invoice-merge-tauri/
├─ src/
│  ├─ App.tsx
│  ├─ main.tsx
│  └─ components/
│      ├─ FileList.tsx
│      └─ Controls.tsx
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs
│  │  ├─ fs_scan.rs
│  │  ├─ merge.rs
│  │  └─ model.rs
│  ├─ tauri.conf.json
│  └─ Cargo.toml
└─ package.json
```

## 3. 数据模型

### 3.1 前后端共享的文件描述（Rust 端定义，序列化给前端）

```rust
// src-tauri/src/model.rs
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct InvoiceFile {
    pub path: String,
    pub file_name: String,
    pub ext: String,
    pub modified_ts: i64,   // Unix 时间戳（秒）
    pub size: u64,          // 字节数
}
```

前端收到后，可用于显示和排序。

### 3.2 合并参数

```rust
#[derive(Serialize, Deserialize)]
pub enum SortMode {
    FileNameAsc,
    ModifiedAsc,
}

#[derive(Serialize, Deserialize)]
pub struct MergeRequest {
    pub folder_path: String,
    pub files: Vec<InvoiceFile>,  // 前端可以自定义排序后传回
    pub sort_mode: SortMode,      // 如果为空则以 files 顺序为准
    pub output_file_name: Option<String>,
}
```

返回：

```rust
#[derive(Serialize, Deserialize)]
pub struct MergeResult {
    pub success: bool,
    pub output_path: String,
    pub failed_files: Vec<String>,
    pub message: Option<String>,
}
```

## 4. Rust 后端设计

### 4.1 扫描文件夹（scan_folder）

```rust
// src-tauri/src/fs_scan.rs
use std::fs;
use std::path::Path;
use chrono::TimeZone;
use crate::model::InvoiceFile;

const VALID_EXT: [&str; 5] = ["pdf", "jpg", "jpeg", "png", "heic"];

pub fn scan_folder(path: &str) -> tauri::Result<Vec<InvoiceFile>> {
    let mut result = Vec::new();
    let dir = fs::read_dir(path)?;
    for entry in dir {
        let entry = entry?;
        let metadata = entry.metadata()?;

        if !metadata.is_file() {
            continue;
        }

        let path_buf = entry.path();
        let ext = path_buf
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !VALID_EXT.contains(&ext.as_str()) {
            continue;
        }

        let file_name = path_buf
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        let modified = metadata.modified().ok();
        let modified_ts = modified
            .and_then(|t| t.elapsed().ok())
            .map(|e| {
                let now = chrono::Utc::now();
                let secs_ago = e.as_secs() as i64;
                now.timestamp() - secs_ago
            })
            .unwrap_or(0);

        result.push(InvoiceFile {
            path: path_buf.to_string_lossy().to_string(),
            file_name,
            ext,
            modified_ts,
            size: metadata.len(),
        });
    }

    Ok(result)
}
```

> 说明：上面时间戳计算是一个相对粗略写法，具体实现可以直接用 `filetime` / `chrono` 读取元数据。

### 4.2 图片 → PDF

思路：
- 使用 `image` crate / `imageproc` 解码 jpg/png/heic
- 使用一个简单的 PDF 生成库（例如 `pdf-writer` 或 `printpdf`）生成单页 A4 PDF
- 返回一个临时文件路径，再参与合并

伪代码：

```rust
fn image_to_pdf(image_path: &str, out_pdf_path: &str) -> anyhow::Result<()> {
    // 1. decode image (image::open)
    // 2. 计算缩放比例，使其等比缩放后适配 A4
    // 3. 在 PDF 页面中居中绘制
    // 4. 写入 out_pdf_path
    Ok(())
}
```

### 4.3 PDF 合并

思路：
- 使用 `lopdf` 或 `pdfium-render` 打开 PDF
- 将每个源 PDF 的页面逐一 append 到目标 PDF
- 最终写出到指定路径

伪代码：

```rust
fn merge_pdfs(pdf_paths: &[String], output: &str) -> anyhow::Result<()> {
    // 创建 target PDF 文档
    // 循环加载每个 pdf_paths[i]
    // 把 pages append 进去
    // 保存 output
    Ok(())
}
```

### 4.4 Tauri Commands

```rust
// src-tauri/src/main.rs
mod fs_scan;
mod merge;
mod model;

use crate::fs_scan::scan_folder;
use crate::merge::{merge_invoices_impl};
use crate::model::{InvoiceFile, MergeRequest, MergeResult};

#[tauri::command]
async fn scan_folder_cmd(folder_path: String) -> Result<Vec<InvoiceFile>, String> {
    scan_folder(&folder_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn merge_invoices_cmd(req: MergeRequest) -> Result<MergeResult, String> {
    merge_invoices_impl(req).map_err(|e| e.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            scan_folder_cmd,
            merge_invoices_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}
```

## 5. 前端（React + TS）设计

### 5.1 状态结构

```ts
type InvoiceFile = {
  path: string;
  file_name: string;
  ext: string;
  modified_ts: number;
  size: number;
};

type SortMode = "FileNameAsc" | "ModifiedAsc";

interface AppState {
  folderPath: string;
  files: InvoiceFile[];
  sortMode: SortMode;
  isMerging: boolean;
  progress: number;      // 0-100
  outputPath?: string;
  error?: string;
}
```

### 5.2 基本调用示例

```ts
import { invoke } from "@tauri-apps/api/tauri";
import { open } from "@tauri-apps/api/dialog";

async function selectFolder() {
  const folder = await open({
    directory: true,
    multiple: false,
  });

  if (!folder || Array.isArray(folder)) return;

  const files = await invoke<InvoiceFile[]>("scan_folder_cmd", {
    folderPath: folder,
  });

  // set state
}
```

合并：

```ts
async function merge() {
  setIsMerging(true);
  try {
    const result = await invoke<MergeResult>("merge_invoices_cmd", {
      req: {
        folderPath,
        files,
        sortMode,
        outputFileName: null,
      },
    });
    // 根据 result 更新 UI
  } catch (e) {
    setError(String(e));
  } finally {
    setIsMerging(false);
  }
}
```

### 5.3 进度条

- 简单做法：前端只在「开始」与「结束」两端切换状态，进度条走假进度。
- 高级做法：Rust 端通过 `tauri::Window::emit` 持续发送进度事件，前端用 `listen` 订阅。

事件名示例：`"merge-progress"`，payload 是 `{ current: number, total: number }`。

## 6. 打包与发布

### 6.1 开发启动

```bash
# 安装依赖
npm install
# 运行开发环境
npm run tauri dev
```

### 6.2 构建

```bash
npm run tauri build
```

- macOS 产物：`.app`，可签名后分发
- Windows 产物：`.msi` 或 `.exe` 安装包

## 7. 日志与错误处理

- Rust 端使用 `log` + `env_logger` 简单记录
- 合并失败时：
  - 记录具体哪个文件失败
  - 返回 `failed_files` 列表给前端，用于在 UI 中提示  

## 8. 安全与隐私

- 不访问网络，Tauri 默认不开启 HTTP 请求权限（不添加相关 API）
- 不扫描用户其他目录，只处理用户选择的文件夹
- 不上传任何数据，日志仅在本地
