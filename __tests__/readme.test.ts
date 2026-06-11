import { describe, expect, test } from "bun:test";
import { renderReadmeContent } from "../src/readme.ts";

describe("renderReadmeContent", () => {
	test("starts with the kaged agent memory heading", () => {
		const readme = renderReadmeContent({ project_id: "music-site" });
		expect(readme.startsWith("# kaged agent memory")).toBe(true);
	});

	test("includes the project id in the opening sentence", () => {
		const readme = renderReadmeContent({ project_id: "music-site" });
		expect(readme).toContain("`music-site`");
	});

	test("documents the per-agent storage convention", () => {
		const readme = renderReadmeContent({ project_id: "x" });
		expect(readme).toContain("`agent/`");
		expect(readme).toContain("`subagent/<name>/`");
		expect(readme).toContain("`subagent/<parent>.<child>/`");
		expect(readme).toContain("`project/`");
	});

	test("documents what subdirectories contain", () => {
		const readme = renderReadmeContent({ project_id: "x" });
		expect(readme).toContain("Per-event memory files named `<id>.md`");
		expect(readme).toContain("16-character hex");
		expect(readme).toContain("`facts.md`");
		expect(readme).toContain("`transcripts/`");
	});

	test("includes the gitignore-or-commit guidance section", () => {
		const readme = renderReadmeContent({ project_id: "x" });
		expect(readme).toMatch(/should i commit/i);
		expect(readme).toContain("gitignore");
	});

	test("includes the safe-to-edit / not-safe-to-edit section", () => {
		const readme = renderReadmeContent({ project_id: "x" });
		expect(readme).toMatch(/safe to hand-edit/i);
		expect(readme).toMatch(/not safe/i);
		expect(readme).toContain("transcripts/");
	});

	test("output ends with a single trailing newline", () => {
		const readme = renderReadmeContent({ project_id: "x" });
		expect(readme.endsWith("\n")).toBe(true);
		expect(readme.endsWith("\n\n")).toBe(false);
	});

	test("output is deterministic for the same input", () => {
		const a = renderReadmeContent({ project_id: "music-site" });
		const b = renderReadmeContent({ project_id: "music-site" });
		expect(a).toBe(b);
	});

	test("different project_ids produce different output", () => {
		const a = renderReadmeContent({ project_id: "music-site" });
		const b = renderReadmeContent({ project_id: "code-review" });
		expect(a).not.toBe(b);
	});

	test("empty project_id throws", () => {
		expect(() => renderReadmeContent({ project_id: "" })).toThrow(/project_id/i);
	});
});
