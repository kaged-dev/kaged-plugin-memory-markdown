import { describe, expect, test } from "bun:test";
import { buildEntryFile, type MemoryEntry, parseEntryFile } from "../src/frontmatter.ts";

const exampleEntry: MemoryEntry = {
	id: "0034f8b2e1d40000",
	created_at: "2026-05-27T10:00:00.000Z",
	agent_path: "primary.subagents.researcher",
	session_id: "ses_abc123",
	operator_id: "ashley",
	tags: ["auth", "jwt", "bug"],
	context: "Debugging the JWT expiry issue raised in #142",
	kind: "retain",
	body:
		"Spent two loops debugging JWT expiry — root cause was clock skew on the deploy host.\n" +
		"Fix: NTP. Don't re-diagnose this.\n",
};

describe("buildEntryFile", () => {
	test("produces a file with --- delimited YAML frontmatter and the body", () => {
		const text = buildEntryFile(exampleEntry);
		expect(text.startsWith("---\n")).toBe(true);
		const parts = text.split("---\n");
		expect(parts.length).toBeGreaterThanOrEqual(3);
		expect(text).toContain("Spent two loops debugging JWT expiry");
	});

	test("emits scalar fields in the frontmatter", () => {
		const text = buildEntryFile(exampleEntry);
		expect(text).toContain("id: 0034f8b2e1d40000");
		expect(text).toContain("agent_path: primary.subagents.researcher");
		expect(text).toContain("session_id: ses_abc123");
		expect(text).toContain("operator_id: ashley");
		expect(text).toContain("kind: retain");
	});

	test("emits tags as a YAML array", () => {
		const text = buildEntryFile(exampleEntry);
		expect(text).toMatch(/tags:\s*(\[|\n)/);
	});

	test("omits optional fields when not provided", () => {
		const minimal: MemoryEntry = {
			id: "0034f8b2e1d40000",
			created_at: "2026-05-27T10:00:00.000Z",
			agent_path: "primary",
			session_id: "ses_abc123",
			operator_id: "ashley",
			kind: "retain",
			body: "minimal note",
		};
		const text = buildEntryFile(minimal);
		expect(text).not.toContain("tags:");
		expect(text).not.toContain("context:");
	});

	test("body ending without trailing newline still produces a file ending with newline", () => {
		const entry: MemoryEntry = { ...exampleEntry, body: "no trailing newline" };
		const text = buildEntryFile(entry);
		expect(text.endsWith("\n")).toBe(true);
	});
});

describe("parseEntryFile", () => {
	test("round-trips a full entry", () => {
		const text = buildEntryFile(exampleEntry);
		const result = parseEntryFile(text);
		expect(result).toEqual(exampleEntry);
	});

	test("round-trips a minimal entry (no optional fields)", () => {
		const minimal: MemoryEntry = {
			id: "0034f8b2e1d40000",
			created_at: "2026-05-27T10:00:00.000Z",
			agent_path: "primary",
			session_id: "ses_abc123",
			operator_id: "ashley",
			kind: "retain",
			body: "minimal note\n",
		};
		const text = buildEntryFile(minimal);
		const result = parseEntryFile(text);
		expect(result).toEqual(minimal);
	});

	test("preserves snake_case keys (does not camelCase them)", () => {
		const text = buildEntryFile(exampleEntry);
		const result = parseEntryFile(text);
		expect(result.agent_path).toBe("primary.subagents.researcher");
		expect(result.session_id).toBe("ses_abc123");
		expect(result.operator_id).toBe("ashley");
		expect(result.created_at).toBe("2026-05-27T10:00:00.000Z");
	});

	test("preserves multi-line body content", () => {
		const multiline: MemoryEntry = {
			...exampleEntry,
			body: "Line 1\nLine 2\n\nParagraph 2\n",
		};
		const text = buildEntryFile(multiline);
		const result = parseEntryFile(text);
		expect(result.body).toBe(multiline.body);
	});

	test("throws on file with no frontmatter delimiters", () => {
		expect(() => parseEntryFile("just a body, no frontmatter")).toThrow(/frontmatter/i);
	});

	test("throws on file with malformed YAML in frontmatter", () => {
		const bad = "---\n  bad indent: : :\n---\nbody\n";
		expect(() => parseEntryFile(bad)).toThrow();
	});

	test("throws on missing required field", () => {
		const missingId =
			"---\ncreated_at: 2026-05-27T10:00:00.000Z\nagent_path: primary\nsession_id: ses_x\noperator_id: ashley\nkind: retain\n---\nbody\n";
		expect(() => parseEntryFile(missingId)).toThrow(/id/i);
	});

	test("throws on invalid kind value", () => {
		const badKind =
			"---\nid: 0034f8b2e1d40000\ncreated_at: 2026-05-27T10:00:00.000Z\nagent_path: primary\nsession_id: ses_x\noperator_id: ashley\nkind: bogus\n---\nbody\n";
		expect(() => parseEntryFile(badKind)).toThrow(/kind/i);
	});

	test("accepts each valid kind", () => {
		for (const kind of ["retain", "transcript", "injection-source"] as const) {
			const entry: MemoryEntry = { ...exampleEntry, kind };
			const result = parseEntryFile(buildEntryFile(entry));
			expect(result.kind).toBe(kind);
		}
	});
});
