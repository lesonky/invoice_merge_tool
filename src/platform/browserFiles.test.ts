import { describe, expect, test } from "vitest";
import { BrowserFileRegistry, filesToSelection, isSupportedFile } from "./browserFiles";

describe("browser file selection", () => {
  test("accepts only the Web format set", () => {
    expect(isSupportedFile(new File([], "a.PDF"))).toBe(true);
    expect(isSupportedFile(new File([], "a.webp"))).toBe(true);
    expect(isSupportedFile(new File([], "a.heic"))).toBe(false);
    expect(isSupportedFile(new File([], "a.tiff"))).toBe(false);
  });

  test("maps files to stable UI metadata and preserves relative folder", () => {
    const pdf = new File([new Uint8Array([1, 2])], "one.pdf", { lastModified: 2000 });
    Object.defineProperty(pdf, "webkitRelativePath", { value: "Invoices/one.pdf" });
    const selection = filesToSelection([pdf]);
    expect(selection.folderLabel).toBe("Invoices");
    expect(selection.files[0]).toMatchObject({
      file_name: "one.pdf",
      ext: "pdf",
      modified_ts: 2,
      size: 2
    });
  });

  test("registry resolves selected bytes and clears stale files", async () => {
    const registry = new BrowserFileRegistry();
    const first = new File(["first"], "first.pdf");
    const selection = registry.replace([first]);
    expect(new TextDecoder().decode(await registry.read(selection.files[0]))).toBe("first");
    registry.clear();
    await expect(registry.read(selection.files[0])).rejects.toThrow("File is no longer available");
  });
});
