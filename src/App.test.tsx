import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { InvoiceFile, MergeResult } from "@shared-types/index";
import type { AppPlatform } from "./platform";

const pdfJsMocks = vi.hoisted(() => ({
  workerOptions: { workerSrc: "" },
  getDocument: vi.fn()
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: pdfJsMocks.workerOptions,
  getDocument: pdfJsMocks.getDocument
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/pdf.worker.min.mjs"
}));

async function loadApp() {
  vi.stubGlobal("DOMMatrix", class DOMMatrixMock {});
  vi.resetModules();
  const module = await import("./App");
  return module.default;
}

function meta(fileName: string, path = fileName): InvoiceFile {
  const dot = fileName.lastIndexOf(".");
  return {
    path,
    file_name: fileName,
    ext: dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "",
    modified_ts: 0,
    size: 1024
  };
}

function fakePlatform(overrides: Partial<AppPlatform> = {}): AppPlatform {
  return {
    kind: "web",
    selectSource: vi.fn(async () => null),
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
    imageUrl: vi.fn(() => "blob:image"),
    merge: vi.fn(async () => ({
      success: true,
      output_path: "Merged_Invoices.pdf",
      failed_files: [],
      message: null
    })),
    dispose: vi.fn(),
    ...overrides
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function stubMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
}

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  stubMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  test("falls back to zh and dark when persisted settings are invalid", async () => {
    localStorage.setItem("app_lang", "fr");
    localStorage.setItem("app_theme", "sepia");

    const App = await loadApp();
    const platform = fakePlatform();
    const { container } = render(<App platform={platform} />);

    expect(screen.getByLabelText("输出文件名")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "选择文件夹" }).length).toBeGreaterThan(0);
    expect(localStorage.getItem("app_lang")).toBe("zh");
    expect(localStorage.getItem("app_theme")).toBe("dark");
    expect((container.firstChild as HTMLElement | null)?.className ?? "").toContain("bg-[#0B0E14]");
  });

  test("loads browser-selected files and enables merge", async () => {
    const App = await loadApp();
    const platform = fakePlatform({
      selectSource: vi.fn(async () => ({
        folderLabel: "Invoices",
        files: [meta("one.png", "web:one.png")]
      }))
    });

    render(<App platform={platform} />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    });

    expect(await screen.findByDisplayValue("Invoices")).toBeTruthy();
    expect(screen.getByText("one.png")).toBeTruthy();
    expect((screen.getByRole("button", { name: "合并并导出" }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("passes the custom filename to platform merge", async () => {
    const App = await loadApp();
    const platform = fakePlatform({
      selectSource: vi.fn(async () => ({
        folderLabel: "Invoices",
        files: [meta("one.png", "web:one.png")]
      }))
    });

    render(<App platform={platform} />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    });
    await screen.findByDisplayValue("Invoices");
    fireEvent.change(screen.getByLabelText("输出文件名"), { target: { value: "June" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "合并并导出" }));
    });

    expect(platform.merge).toHaveBeenCalledWith(
      expect.objectContaining({ outputFileName: "June" }),
      expect.any(Function)
    );
  });

  test("cancelling source selection leaves the current state unchanged", async () => {
    const App = await loadApp();
    const platform = fakePlatform({
      selectSource: vi
        .fn()
        .mockResolvedValueOnce({
          folderLabel: "Invoices",
          files: [meta("one.png", "web:one.png")]
        })
        .mockResolvedValueOnce(null)
    });

    render(<App platform={platform} />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    });
    await screen.findByDisplayValue("Invoices");
    expect(screen.getByText("one.png")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    });

    expect(screen.getByDisplayValue("Invoices")).toBeTruthy();
    expect(screen.getByText("one.png")).toBeTruthy();
  });

  test("keeps the latest overlapping source selection", async () => {
    const firstSelection = deferred<{ folderLabel: string; files: InvoiceFile[] } | null>();
    const secondSelection = deferred<{ folderLabel: string; files: InvoiceFile[] } | null>();
    const App = await loadApp();
    const platform = fakePlatform({
      selectSource: vi
        .fn()
        .mockImplementationOnce(() => firstSelection.promise)
        .mockImplementationOnce(() => secondSelection.promise)
    });

    render(<App platform={platform} />);

    const [headerChooseButton] = screen.getAllByRole("button", { name: "选择文件夹" });
    fireEvent.click(headerChooseButton);
    fireEvent.click(headerChooseButton);

    await act(async () => {
      secondSelection.resolve({
        folderLabel: "Latest",
        files: [meta("latest.png", "web:latest.png")]
      });
    });

    expect(await screen.findByDisplayValue("Latest")).toBeTruthy();
    expect(screen.getByText("latest.png")).toBeTruthy();

    await act(async () => {
      firstSelection.resolve({
        folderLabel: "Stale",
        files: [meta("stale.png", "web:stale.png")]
      });
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Latest")).toBeTruthy();
      expect(screen.getByText("latest.png")).toBeTruthy();
      expect(screen.queryByDisplayValue("Stale")).toBeNull();
      expect(screen.queryByText("stale.png")).toBeNull();
    });
  });

  test("shows progress updates during merge", async () => {
    const mergeCompletion = deferred<MergeResult>();
    const App = await loadApp();
    const platform = fakePlatform({
      selectSource: vi.fn(async () => ({
        folderLabel: "Invoices",
        files: [meta("one.png", "web:one.png")]
      })),
      merge: vi.fn(async (_input, onProgress) => {
        onProgress({ current: 1, total: 4, phase: "scan" });
        return mergeCompletion.promise;
      })
    });

    render(<App platform={platform} />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    });
    await screen.findByDisplayValue("Invoices");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "合并并导出" }));
    });

    expect(await screen.findByText("读取文件中… (1/4)")).toBeTruthy();
    await act(async () => {
      mergeCompletion.resolve({
        success: true,
        output_path: "June.pdf",
        failed_files: [],
        message: null
      });
    });
  });

  test("disables all choose-folder controls during merge", async () => {
    const mergeCompletion = deferred<MergeResult>();
    const App = await loadApp();
    const selectSource = vi.fn(async () => ({
      folderLabel: "Invoices",
      files: [meta("one.png", "web:one.png")]
    }));
    const platform = fakePlatform({
      selectSource,
      merge: vi.fn(async () => mergeCompletion.promise)
    });

    render(<App platform={platform} />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    });
    await screen.findByDisplayValue("Invoices");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "合并并导出" }));
    });

    const chooseButtons = screen.getAllByRole("button", { name: "选择文件夹" }) as HTMLButtonElement[];
    expect(chooseButtons.length).toBeGreaterThan(0);
    chooseButtons.forEach((button) => expect(button.disabled).toBe(true));

    fireEvent.click(chooseButtons[0]);
    expect(selectSource).toHaveBeenCalledTimes(1);

    await act(async () => {
      mergeCompletion.resolve({
        success: true,
        output_path: "done.pdf",
        failed_files: [],
        message: null
      });
    });
  });

  test("shows success and failure dialogs from platform merge results", async () => {
    const App = await loadApp();
    const mergeResults = [
      {
        success: true,
        output_path: "June.pdf",
        failed_files: ["skip.png"],
        message: null
      },
      {
        success: false,
        output_path: "",
        failed_files: [],
        message: "broken"
      }
    ] satisfies MergeResult[];

    const platform = fakePlatform({
      selectSource: vi.fn(async () => ({
        folderLabel: "Invoices",
        files: [meta("one.png", "web:one.png")]
      })),
      merge: vi.fn(async () => {
        const next = mergeResults.shift();
        if (!next) {
          throw new Error("missing merge result");
        }
        return next;
      })
    });

    render(<App platform={platform} />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    });
    await screen.findByDisplayValue("Invoices");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "合并并导出" }));
    });
    expect(await screen.findByText(/June\.pdf/)).toBeTruthy();
    expect(screen.getByText(/失败文件： skip\.png/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "合并并导出" }));
    });
    expect((await screen.findAllByText("broken")).length).toBeGreaterThan(0);
  });

  test("persists language and theme choices across remounts", async () => {
    const App = await loadApp();
    const platform = fakePlatform();
    const { container, unmount } = render(<App platform={platform} />);

    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(screen.getByRole("button", { name: "Light Mode" }));

    expect(localStorage.getItem("app_lang")).toBe("en");
    expect(localStorage.getItem("app_theme")).toBe("light");
    expect((container.firstChild as HTMLElement | null)?.className ?? "").toContain("bg-slate-50");

    unmount();

    render(<App platform={platform} />);

    expect(screen.getByLabelText("Output Filename")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Choose Folder" }).length).toBeGreaterThan(0);
  });

  test("ignores a pending source selection after unmount", async () => {
    const pendingSelection = deferred<{ folderLabel: string; files: InvoiceFile[] } | null>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const App = await loadApp();
    const platform = fakePlatform({
      selectSource: vi.fn(() => pendingSelection.promise)
    });

    const { unmount } = render(<App platform={platform} />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    });

    unmount();

    await act(async () => {
      pendingSelection.resolve({
        folderLabel: "Late",
        files: [meta("late.png", "web:late.png")]
      });
      await Promise.resolve();
    });

    expect(platform.dispose).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("ignores late merge updates after unmount", async () => {
    const mergeCompletion = deferred<MergeResult>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let emitProgress: ((payload: { current: number; total: number; phase: "scan" | "convert" | "merge" | "write" }) => void) | null = null;
    const App = await loadApp();
    const platform = fakePlatform({
      selectSource: vi.fn(async () => ({
        folderLabel: "Invoices",
        files: [meta("one.png", "web:one.png")]
      })),
      merge: vi.fn(async (_input, onProgress) => {
        emitProgress = onProgress;
        return mergeCompletion.promise;
      })
    });

    const { unmount } = render(<App platform={platform} />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "选择文件夹" })[0]);
    });
    await screen.findByDisplayValue("Invoices");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "合并并导出" }));
    });

    unmount();

    await act(async () => {
      emitProgress?.({ current: 1, total: 2, phase: "merge" });
      mergeCompletion.resolve({
        success: true,
        output_path: "late.pdf",
        failed_files: [],
        message: null
      });
      await Promise.resolve();
    });

    expect(platform.dispose).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test("disposes the platform on unmount", async () => {
    const App = await loadApp();
    const platform = fakePlatform();
    const { unmount } = render(<App platform={platform} />);

    unmount();

    expect(platform.dispose).toHaveBeenCalledTimes(1);
  });
});
