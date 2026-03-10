import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

describe("favicon", () => {
  test("ships root-served favicon assets with browser fallbacks", () => {
    expect(existsSync("public/favicon.svg")).toBe(true);
    expect(existsSync("public/favicon.png")).toBe(true);
    expect(existsSync("public/favicon.ico")).toBe(true);

    const html = readFileSync("public/index.html", "utf8");
    expect(html).toContain('type="image/svg+xml"');
    expect(html).toContain('type="image/png"');
    expect(html).toContain('href="/favicon.svg"');
    expect(html).toContain('href="/favicon.png"');

    const server = readFileSync("src/server/index.ts", "utf8");
    expect(server).toContain('app.get("/favicon.svg"');
    expect(server).toContain('app.get("/favicon.png"');
    expect(server).toContain('app.get("/favicon.ico"');
    expect(server).toContain('return "image/svg+xml"');
    expect(server).toContain('return "image/png"');
    expect(server).toContain('return "image/x-icon"');
  });
});
