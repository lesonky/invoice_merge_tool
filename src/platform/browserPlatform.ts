import type { InvoiceFile, MergeResult, ProgressPayload } from "@shared-types/index";
import { BrowserFileRegistry } from "./browserFiles";
import { mergeBrowserFiles } from "./browserMerge";
import type { AppPlatform, MergeInput, SourceSelection } from "./types";

const BROWSER_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.bmp,.gif";

type BrowserRegistry = Pick<BrowserFileRegistry, "replace" | "read" | "imageUrl" | "dispose">;

interface BrowserPlatformDeps {
  document?: Document;
  registry?: BrowserRegistry;
  url?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}

function setWebkitDirectory(input: HTMLInputElement): void {
  Object.defineProperty(input, "webkitdirectory", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: true
  });
}

function toMergeResult(result: Awaited<ReturnType<typeof mergeBrowserFiles>>): MergeResult {
  return {
    success: true,
    output_path: result.outputFileName,
    failed_files: result.failedFiles,
    message: null
  };
}

export function createBrowserPlatform(deps: BrowserPlatformDeps = {}): AppPlatform {
  const doc = deps.document ?? document;
  const registry = deps.registry ?? new BrowserFileRegistry();
  const urlApi = deps.url ?? URL;

  const selectSource = (): Promise<SourceSelection | null> => {
    return new Promise((resolve) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = BROWSER_ACCEPT;
      setWebkitDirectory(input);

      let settled = false;

      const cleanup = () => {
        input.removeEventListener("change", handleChange);
        input.removeEventListener("cancel", handleCancel);
        input.remove();
      };

      const settle = (value: SourceSelection | null) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      };

      const handleChange = () => {
        const fileList = input.files ? Array.from(input.files) : [];
        if (!fileList.length) {
          settle(null);
          return;
        }
        settle(registry.replace(fileList));
      };

      const handleCancel = () => {
        settle(null);
      };

      input.addEventListener("change", handleChange);
      input.addEventListener("cancel", handleCancel);
      doc.body.appendChild(input);
      input.click();
    });
  };

  const merge = async (
    input: MergeInput,
    onProgress: (payload: ProgressPayload) => void
  ): Promise<MergeResult> => {
    const result = await mergeBrowserFiles(input, (file: InvoiceFile) => registry.read(file), onProgress);
    const downloadBytes = new Uint8Array(result.bytes.byteLength);
    downloadBytes.set(result.bytes);
    const download = new Blob([downloadBytes.buffer], { type: "application/pdf" });
    const href = urlApi.createObjectURL(download);
    try {
      const anchor = doc.createElement("a");
      anchor.href = href;
      anchor.download = result.outputFileName;
      doc.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      urlApi.revokeObjectURL(href);
    }
    return toMergeResult(result);
  };

  return {
    kind: "web",
    selectSource,
    readFile: (file) => registry.read(file),
    imageUrl: (file) => registry.imageUrl(file),
    merge,
    dispose: () => registry.dispose()
  };
}
