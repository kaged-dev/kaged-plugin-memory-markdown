import { describe, expect, test } from "bun:test";
import { type ResolveContext, resolveStoreUri } from "../src/uri.ts";

const ctx: ResolveContext = {
	project_id: "music-site",
	project_root: "/home/ashley/projects/music-site",
	config_root: "/home/ashley/.config/kaged",
};

describe("resolveStoreUri", () => {
	describe("config:/ resolution", () => {
		test("config:/memory → <config_root>/memory/<project_id>", () => {
			expect(resolveStoreUri("config:/memory", ctx)).toBe(
				"/home/ashley/.config/kaged/memory/music-site",
			);
		});

		test("config:/memory/special-place → <config_root>/memory/special-place/<project_id>", () => {
			expect(resolveStoreUri("config:/memory/special-place", ctx)).toBe(
				"/home/ashley/.config/kaged/memory/special-place/music-site",
			);
		});

		test("config:/ with trailing slash is normalized", () => {
			expect(resolveStoreUri("config:/memory/", ctx)).toBe(
				"/home/ashley/.config/kaged/memory/music-site",
			);
		});
	});

	describe("project:/ resolution", () => {
		test("project:/memory → <project_root>/memory (no project_id appended)", () => {
			expect(resolveStoreUri("project:/memory", ctx)).toBe(
				"/home/ashley/projects/music-site/memory",
			);
		});

		test("project:/sub/dir → <project_root>/sub/dir", () => {
			expect(resolveStoreUri("project:/sub/dir", ctx)).toBe(
				"/home/ashley/projects/music-site/sub/dir",
			);
		});

		test("project:/ with trailing slash is normalized", () => {
			expect(resolveStoreUri("project:/memory/", ctx)).toBe(
				"/home/ashley/projects/music-site/memory",
			);
		});
	});

	describe("path traversal rejection", () => {
		test("config:/../escape is rejected", () => {
			expect(() => resolveStoreUri("config:/../escape", ctx)).toThrow(/traversal/i);
		});

		test("project:/../escape is rejected", () => {
			expect(() => resolveStoreUri("project:/../escape", ctx)).toThrow(/traversal/i);
		});

		test("config:/foo/../bar is rejected (mid-path traversal)", () => {
			expect(() => resolveStoreUri("config:/foo/../bar", ctx)).toThrow(/traversal/i);
		});

		test("project:/memory/../../etc is rejected", () => {
			expect(() => resolveStoreUri("project:/memory/../../etc", ctx)).toThrow(/traversal/i);
		});
	});

	describe("scheme validation", () => {
		test("naked path (no scheme) is rejected", () => {
			expect(() => resolveStoreUri("/home/ashley/memory", ctx)).toThrow(/scheme/i);
		});

		test("relative path is rejected", () => {
			expect(() => resolveStoreUri("memory", ctx)).toThrow(/scheme/i);
		});

		test("file:// scheme is rejected", () => {
			expect(() => resolveStoreUri("file:///etc/passwd", ctx)).toThrow(/scheme/i);
		});

		test("https:// scheme is rejected", () => {
			expect(() => resolveStoreUri("https://example.com/memory", ctx)).toThrow(/scheme/i);
		});

		test("empty string is rejected", () => {
			expect(() => resolveStoreUri("", ctx)).toThrow();
		});
	});

	describe("context validation", () => {
		test("empty project_id is rejected for config:/ resolution", () => {
			expect(() => resolveStoreUri("config:/memory", { ...ctx, project_id: "" })).toThrow(
				/project_id/i,
			);
		});

		test("empty project_root is rejected for project:/ resolution", () => {
			expect(() => resolveStoreUri("project:/memory", { ...ctx, project_root: "" })).toThrow(
				/project_root/i,
			);
		});

		test("empty config_root is rejected for config:/ resolution", () => {
			expect(() => resolveStoreUri("config:/memory", { ...ctx, config_root: "" })).toThrow(
				/config_root/i,
			);
		});

		test("project_root is not consulted when resolving config:/ URIs", () => {
			const result = resolveStoreUri("config:/memory", { ...ctx, project_root: "" });
			expect(result).toBe("/home/ashley/.config/kaged/memory/music-site");
		});

		test("config_root is not consulted when resolving project:/ URIs", () => {
			const result = resolveStoreUri("project:/memory", { ...ctx, config_root: "" });
			expect(result).toBe("/home/ashley/projects/music-site/memory");
		});
	});
});
