import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { buildEntryFile, type MemoryEntry, parseEntryFile } from "../src/frontmatter.ts";
import { isValidMemoryId } from "../src/id.ts";
import {
	ContentTooLargeError,
	collectTags,
	deleteEntry,
	ensureStoreReady,
	formatInjection,
	getRecentRetains,
	readEntries,
	recall,
	writeEntry,
	writeTranscript,
} from "../src/io.ts";

function requireValue<T>(value: T | null | undefined): T {
	expect(value).toBeDefined();
	if (value === null || value === undefined) {
		throw new Error("Expected value to be defined");
	}
	return value;
}

const TEST_DIR = "/tmp/kaged-memory-markdown-io-test";

function cleanTestDir(): void {
	if (existsSync(TEST_DIR)) {
		rmSync(TEST_DIR, { recursive: true, force: true });
	}
}

beforeEach(() => {
	cleanTestDir();
});

afterEach(() => {
	cleanTestDir();
});

const baseWriteInput = {
	directory: `${TEST_DIR}/agent`,
	content: "JWT expiry bug was clock skew. NTP fixes it.",
	context: "Debugging #142",
	tags: ["auth", "jwt"],
	agent_path: "primary",
	session_id: "ses_abc123",
	operator_id: "ashley",
} as const;

describe("writeEntry", () => {
	test("creates the directory and writes a .md file with a valid snowflake ID", async () => {
		const result = await writeEntry(baseWriteInput);
		expect(result.status).toBe("stored");
		expect(isValidMemoryId(result.id)).toBe(true);

		const file = Bun.file(`${baseWriteInput.directory}/${result.id}.md`);
		expect(await file.exists()).toBe(true);
	});

	test("written file round-trips through parseEntryFile", async () => {
		const result = await writeEntry(baseWriteInput);
		const content = await Bun.file(`${baseWriteInput.directory}/${result.id}.md`).text();
		const entry = parseEntryFile(content);
		expect(entry.id).toBe(result.id);
		expect(entry.kind).toBe("retain");
		expect(entry.body).toContain("JWT expiry bug");
		expect(entry.tags).toEqual(["auth", "jwt"]);
		expect(entry.context).toBe("Debugging #142");
		expect(entry.agent_path).toBe("primary");
		expect(entry.session_id).toBe("ses_abc123");
		expect(entry.operator_id).toBe("ashley");
	});

	test("omits optional fields when not provided", async () => {
		const result = await writeEntry({
			...baseWriteInput,
			tags: undefined,
			context: undefined,
		});
		const content = await Bun.file(`${baseWriteInput.directory}/${result.id}.md`).text();
		const entry = parseEntryFile(content);
		expect(entry.tags).toBeUndefined();
		expect(entry.context).toBeUndefined();
	});

	test("omits tags when array is empty", async () => {
		const result = await writeEntry({
			...baseWriteInput,
			tags: [],
		});
		const content = await Bun.file(`${baseWriteInput.directory}/${result.id}.md`).text();
		const entry = parseEntryFile(content);
		expect(entry.tags).toBeUndefined();
	});

	test("rejects content > 100 KB with ContentTooLargeError", async () => {
		const huge = "x".repeat(100 * 1024 + 1);
		try {
			await writeEntry({ ...baseWriteInput, content: huge });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ContentTooLargeError);
			expect((err as ContentTooLargeError).code).toBe("content_too_large");
		}
	});

	test("short fact content appends to facts.md", async () => {
		await writeEntry({
			...baseWriteInput,
			content: "NTP fixes clock skew",
		});
		const factsFile = Bun.file(`${baseWriteInput.directory}/facts.md`);
		expect(await factsFile.exists()).toBe(true);
		const factsContent = await factsFile.text();
		expect(factsContent).toContain("- NTP fixes clock skew");
	});

	test("long content does NOT append to facts.md", async () => {
		const longContent = "x".repeat(200);
		await writeEntry({ ...baseWriteInput, content: longContent });
		const factsFile = Bun.file(`${baseWriteInput.directory}/facts.md`);
		expect(await factsFile.exists()).toBe(false);
	});

	test("multi-line content does NOT append to facts.md", async () => {
		await writeEntry({
			...baseWriteInput,
			content: "line one\nline two",
		});
		const factsFile = Bun.file(`${baseWriteInput.directory}/facts.md`);
		expect(await factsFile.exists()).toBe(false);
	});

	test("markdown-structured content does NOT append to facts.md", async () => {
		await writeEntry({ ...baseWriteInput, content: "## Heading" });
		const factsFile = Bun.file(`${baseWriteInput.directory}/facts.md`);
		expect(await factsFile.exists()).toBe(false);
	});

	test("facts.md accumulates across multiple writes", async () => {
		await writeEntry({ ...baseWriteInput, content: "Fact one" });
		await writeEntry({ ...baseWriteInput, content: "Fact two" });
		const factsContent = await Bun.file(`${baseWriteInput.directory}/facts.md`).text();
		expect(factsContent).toContain("- Fact one");
		expect(factsContent).toContain("- Fact two");
	});

	test("each call generates a unique ID", async () => {
		const r1 = await writeEntry(baseWriteInput);
		const r2 = await writeEntry(baseWriteInput);
		expect(r1.id).not.toBe(r2.id);
	});
});

describe("readEntries", () => {
	test("returns entries from written files", async () => {
		await writeEntry(baseWriteInput);
		await writeEntry({ ...baseWriteInput, content: "second entry" });
		const entries = await readEntries(baseWriteInput.directory);
		expect(entries.length).toBe(2);
	});

	test("returns empty array for non-existent directory", async () => {
		const entries = await readEntries(`${TEST_DIR}/nonexistent`);
		expect(entries).toEqual([]);
	});

	test("skips facts.md", async () => {
		mkdirSync(`${TEST_DIR}/skiptest`, { recursive: true });
		await Bun.write(`${TEST_DIR}/skiptest/facts.md`, "- a fact\n");
		const entry: MemoryEntry = {
			id: "0034f8b2e1d40000",
			created_at: "2026-05-27T10:00:00.000Z",
			agent_path: "primary",
			session_id: "ses_x",
			operator_id: "ashley",
			kind: "retain",
			body: "real entry\n",
		};
		await Bun.write(`${TEST_DIR}/skiptest/0034f8b2e1d40000.md`, buildEntryFile(entry));
		const entries = await readEntries(`${TEST_DIR}/skiptest`);
		expect(entries.length).toBe(1);
		expect(entries[0]?.id).toBe("0034f8b2e1d40000");
	});

	test("skips README.md", async () => {
		mkdirSync(`${TEST_DIR}/skiptest2`, { recursive: true });
		await Bun.write(`${TEST_DIR}/skiptest2/README.md`, "# readme\n");
		const entries = await readEntries(`${TEST_DIR}/skiptest2`);
		expect(entries).toEqual([]);
	});

	test("skips corrupt files without throwing", async () => {
		mkdirSync(`${TEST_DIR}/corrupttest`, { recursive: true });
		await Bun.write(`${TEST_DIR}/corrupttest/bad.md`, "not valid frontmatter");
		const entry: MemoryEntry = {
			id: "0034f8b2e1d40001",
			created_at: "2026-05-27T10:00:00.000Z",
			agent_path: "primary",
			session_id: "ses_x",
			operator_id: "ashley",
			kind: "retain",
			body: "good entry\n",
		};
		await Bun.write(`${TEST_DIR}/corrupttest/0034f8b2e1d40001.md`, buildEntryFile(entry));
		const entries = await readEntries(`${TEST_DIR}/corrupttest`);
		expect(entries.length).toBe(1);
		expect(entries[0]?.id).toBe("0034f8b2e1d40001");
	});
});

describe("recall", () => {
	async function seedEntries(): Promise<void> {
		const now = Date.now();
		const dir = `${TEST_DIR}/recall`;
		mkdirSync(dir, { recursive: true });

		const entries: MemoryEntry[] = [
			{
				id: "0000000000000001",
				created_at: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
				agent_path: "primary",
				session_id: "ses_1",
				operator_id: "ashley",
				tags: ["auth", "jwt"],
				kind: "retain",
				body: "JWT expiry bug was clock skew. NTP fixes it.",
			},
			{
				id: "0000000000000002",
				created_at: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
				agent_path: "primary",
				session_id: "ses_2",
				operator_id: "ashley",
				tags: ["deploy"],
				kind: "retain",
				body: "Deploy target is Cloudflare Workers.",
			},
			{
				id: "0000000000000003",
				created_at: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
				agent_path: "primary",
				session_id: "ses_3",
				operator_id: "ashley",
				tags: ["auth"],
				kind: "retain",
				body: "Auth uses loopback cookie + nonce file.",
			},
			{
				id: "0000000000000004",
				created_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
				agent_path: "primary",
				session_id: "ses_4",
				operator_id: "ashley",
				kind: "transcript",
				body: "Full session transcript here.",
			},
		];

		for (const e of entries) {
			await Bun.write(`${dir}/${e.id}.md`, buildEntryFile(e));
		}
	}

	test("returns scored results sorted by score desc", async () => {
		await seedEntries();
		const result = await recall({
			directory: `${TEST_DIR}/recall`,
			query: "jwt auth",
		});
		expect(result.count).toBeGreaterThan(0);
		expect(result.query).toBe("jwt auth");
		for (let i = 1; i < result.results.length; i++) {
			const previous = requireValue(result.results[i - 1]);
			const current = requireValue(result.results[i]);
			expect(previous.score).toBeGreaterThanOrEqual(current.score);
		}
	});

	test("filters by tags when provided", async () => {
		await seedEntries();
		const result = await recall({
			directory: `${TEST_DIR}/recall`,
			query: "anything",
			tags: ["deploy"],
		});
		expect(result.count).toBe(1);
		expect(result.results[0]?.tags).toContain("deploy");
	});

	test("tag filter is case-insensitive", async () => {
		await seedEntries();
		const result = await recall({
			directory: `${TEST_DIR}/recall`,
			query: "anything",
			tags: ["DEPLOY"],
		});
		expect(result.count).toBe(1);
	});

	test("respects max_results", async () => {
		await seedEntries();
		const result = await recall({
			directory: `${TEST_DIR}/recall`,
			query: "auth",
			max_results: 1,
		});
		expect(result.count).toBe(1);
	});

	test("returns empty results for non-existent directory", async () => {
		const result = await recall({
			directory: `${TEST_DIR}/nonexistent`,
			query: "anything",
		});
		expect(result.count).toBe(0);
		expect(result.results).toEqual([]);
	});

	test("result shape matches spec (content not body, null for missing context)", async () => {
		await seedEntries();
		const result = await recall({
			directory: `${TEST_DIR}/recall`,
			query: "jwt",
			max_results: 1,
		});
		const first = requireValue(result.results[0]);
		expect(typeof first.content).toBe("string");
		expect(typeof first.id).toBe("string");
		expect(typeof first.created_at).toBe("string");
		expect(typeof first.agent_path).toBe("string");
		expect(Array.isArray(first.tags)).toBe(true);
		expect(typeof first.score).toBe("number");
		expect(first.context === null || typeof first.context === "string").toBe(true);
	});

	test("ties broken by created_at descending", async () => {
		const dir = `${TEST_DIR}/tiebreak`;
		mkdirSync(dir, { recursive: true });
		const now = Date.now();

		const older: MemoryEntry = {
			id: "0000000000000010",
			created_at: new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString(),
			agent_path: "primary",
			session_id: "ses_old",
			operator_id: "ashley",
			kind: "retain",
			body: "unique keyword xyzzy",
		};
		const newer: MemoryEntry = {
			id: "0000000000000011",
			created_at: new Date(now - 99 * 24 * 60 * 60 * 1000).toISOString(),
			agent_path: "primary",
			session_id: "ses_new",
			operator_id: "ashley",
			kind: "retain",
			body: "unique keyword xyzzy",
		};

		await Bun.write(`${dir}/${older.id}.md`, buildEntryFile(older));
		await Bun.write(`${dir}/${newer.id}.md`, buildEntryFile(newer));

		const result = await recall({ directory: dir, query: "xyzzy" });
		expect(result.results[0]?.id).toBe("0000000000000011");
		expect(result.results[1]?.id).toBe("0000000000000010");
	});
});

describe("writeTranscript", () => {
	test("writes a transcript file under transcripts/", async () => {
		const dir = `${TEST_DIR}/transcript`;
		await writeTranscript({
			directory: dir,
			session_id: "ses_abc123",
			agent_path: "primary",
			operator_id: "ashley",
			body: "**Operator:** fix the bug\n**Agent:** done\n",
		});
		const file = Bun.file(`${dir}/transcripts/ses_abc123.md`);
		expect(await file.exists()).toBe(true);
		const content = await file.text();
		const entry = parseEntryFile(content);
		expect(entry.kind).toBe("transcript");
		expect(entry.body).toContain("**Operator:** fix the bug");
	});

	test("upsert semantics: second write overwrites the same file", async () => {
		const dir = `${TEST_DIR}/transcript-upsert`;
		await writeTranscript({
			directory: dir,
			session_id: "ses_upsert",
			agent_path: "primary",
			operator_id: "ashley",
			body: "first version",
		});
		await writeTranscript({
			directory: dir,
			session_id: "ses_upsert",
			agent_path: "primary",
			operator_id: "ashley",
			body: "second version",
		});
		const content = await Bun.file(`${dir}/transcripts/ses_upsert.md`).text();
		expect(content).toContain("second version");
		expect(content).not.toContain("first version");
	});

	test("compactId produces a different filename", async () => {
		const dir = `${TEST_DIR}/transcript-compact`;
		await writeTranscript({
			directory: dir,
			session_id: "ses_c1",
			agent_path: "primary",
			operator_id: "ashley",
			body: "compacted chunk",
			compactId: "abc123",
		});
		const file = Bun.file(`${dir}/transcripts/ses_c1-compact-abc123.md`);
		expect(await file.exists()).toBe(true);
	});

	test("includes tags and context when provided", async () => {
		const dir = `${TEST_DIR}/transcript-meta`;
		await writeTranscript({
			directory: dir,
			session_id: "ses_meta",
			agent_path: "primary",
			operator_id: "ashley",
			body: "transcript body",
			tags: ["debug"],
			context: "session context",
		});
		const content = await Bun.file(`${dir}/transcripts/ses_meta.md`).text();
		const entry = parseEntryFile(content);
		expect(entry.tags).toEqual(["debug"]);
		expect(entry.context).toBe("session context");
	});
});

describe("ensureStoreReady", () => {
	test("creates directory and README.md", async () => {
		const root = `${TEST_DIR}/store-ready`;
		await ensureStoreReady({ storeRoot: root, project_id: "proj_test" });
		expect(existsSync(root)).toBe(true);
		const readme = await Bun.file(`${root}/README.md`).text();
		expect(readme).toContain("proj_test");
		expect(readme).toContain("kaged agent memory");
	});

	test("preserves existing README (operator customization)", async () => {
		const root = `${TEST_DIR}/store-preserve`;
		mkdirSync(root, { recursive: true });
		await Bun.write(`${root}/README.md`, "# My custom README\n");
		await ensureStoreReady({ storeRoot: root, project_id: "proj_test" });
		const readme = await Bun.file(`${root}/README.md`).text();
		expect(readme).toBe("# My custom README\n");
	});

	test("includes store description when provided", async () => {
		const root = `${TEST_DIR}/store-description`;
		await ensureStoreReady({
			storeRoot: root,
			project_id: "proj_test",
			store_description: "Shared team memory for deployment notes.",
		});
		const readme = await Bun.file(`${root}/README.md`).text();
		expect(readme).toContain("## Store description");
		expect(readme).toContain("Shared team memory for deployment notes.");
	});

	test("is idempotent — calling twice does not error", async () => {
		const root = `${TEST_DIR}/store-idem`;
		await ensureStoreReady({ storeRoot: root, project_id: "proj_test" });
		await ensureStoreReady({ storeRoot: root, project_id: "proj_test" });
		expect(existsSync(`${root}/README.md`)).toBe(true);
	});
});

describe("getRecentRetains", () => {
	test("returns only retain-kind entries, sorted by created_at desc", async () => {
		const dir = `${TEST_DIR}/recent`;
		mkdirSync(dir, { recursive: true });

		const now = Date.now();
		const entries: MemoryEntry[] = [
			{
				id: "0000000000000020",
				created_at: new Date(now - 3000).toISOString(),
				agent_path: "primary",
				session_id: "ses_a",
				operator_id: "ashley",
				kind: "retain",
				body: "oldest retain",
			},
			{
				id: "0000000000000021",
				created_at: new Date(now - 1000).toISOString(),
				agent_path: "primary",
				session_id: "ses_b",
				operator_id: "ashley",
				kind: "retain",
				body: "newest retain",
			},
			{
				id: "0000000000000022",
				created_at: new Date(now - 2000).toISOString(),
				agent_path: "primary",
				session_id: "ses_c",
				operator_id: "ashley",
				kind: "transcript",
				body: "a transcript (should be excluded)",
			},
		];

		for (const e of entries) {
			await Bun.write(`${dir}/${e.id}.md`, buildEntryFile(e));
		}

		const retains = await getRecentRetains(dir, 10);
		expect(retains.length).toBe(2);
		expect(retains[0]?.id).toBe("0000000000000021");
		expect(retains[1]?.id).toBe("0000000000000020");
	});

	test("respects maxEntries limit", async () => {
		const dir = `${TEST_DIR}/recent-limit`;
		mkdirSync(dir, { recursive: true });

		const now = Date.now();
		for (let i = 0; i < 5; i++) {
			const entry: MemoryEntry = {
				id: `000000000000003${i}`,
				created_at: new Date(now - i * 1000).toISOString(),
				agent_path: "primary",
				session_id: `ses_${i}`,
				operator_id: "ashley",
				kind: "retain",
				body: `entry ${i}`,
			};
			await Bun.write(`${dir}/${entry.id}.md`, buildEntryFile(entry));
		}

		const retains = await getRecentRetains(dir, 2);
		expect(retains.length).toBe(2);
	});

	test("returns empty for non-existent directory", async () => {
		const retains = await getRecentRetains(`${TEST_DIR}/nope`, 10);
		expect(retains).toEqual([]);
	});
});

describe("formatInjection", () => {
	test("formats entries as bulleted list with tag prefix", () => {
		const entries: MemoryEntry[] = [
			{
				id: "0000000000000040",
				created_at: "2026-05-27T10:00:00.000Z",
				agent_path: "primary",
				session_id: "ses_a",
				operator_id: "ashley",
				tags: ["auth", "jwt"],
				kind: "retain",
				body: "JWT expiry was clock skew. NTP fixes it.",
			},
			{
				id: "0000000000000041",
				created_at: "2026-05-27T09:00:00.000Z",
				agent_path: "primary",
				session_id: "ses_b",
				operator_id: "ashley",
				tags: ["deploy"],
				kind: "retain",
				body: "Deploy target is Cloudflare Workers.",
			},
		];

		const result = formatInjection(entries);
		expect(result).toContain("Known about this project:");
		expect(result).toContain("- [auth, jwt] JWT expiry was clock skew");
		expect(result).toContain("- [deploy] Deploy target is Cloudflare Workers.");
	});

	test("entries without tags have no tag prefix", () => {
		const entries: MemoryEntry[] = [
			{
				id: "0000000000000050",
				created_at: "2026-05-27T10:00:00.000Z",
				agent_path: "primary",
				session_id: "ses_a",
				operator_id: "ashley",
				kind: "retain",
				body: "Untagged memory.",
			},
		];
		const result = formatInjection(entries);
		expect(result).toContain("- Untagged memory.");
		expect(result).not.toContain("[");
	});

	test("returns null for empty array", () => {
		expect(formatInjection([])).toBeNull();
	});

	test("collapses multi-line body to single line", () => {
		const entries: MemoryEntry[] = [
			{
				id: "0000000000000060",
				created_at: "2026-05-27T10:00:00.000Z",
				agent_path: "primary",
				session_id: "ses_a",
				operator_id: "ashley",
				kind: "retain",
				body: "line one\nline two\n\nline four",
			},
		];
		const result = requireValue(formatInjection(entries));
		expect(result).not.toContain("\nline two");
		expect(result).toContain("line one line two line four");
	});

	test("uses custom header and optional tag hint", () => {
		const entries: MemoryEntry[] = [
			{
				id: "0000000000000061",
				created_at: "2026-05-27T10:00:00.000Z",
				agent_path: "primary",
				session_id: "ses_a",
				operator_id: "ashley",
				tags: ["auth"],
				kind: "retain",
				body: "JWT note",
			},
		];

		const result = requireValue(
			formatInjection(entries, {
				header: "Relevant prior context:",
				inject_tag_hint: true,
				known_tags: ["auth", "deploy"],
			}),
		);

		expect(result).toContain("Relevant prior context:");
		expect(result).toContain("Known tags: auth, deploy");
	});
});

describe("deleteEntry", () => {
	test("removes an existing memory file", async () => {
		const retained = await writeEntry(baseWriteInput);
		const result = await deleteEntry(baseWriteInput.directory, retained.id);
		expect(result).toEqual({ status: "forgotten", id: retained.id });
		expect(await Bun.file(`${baseWriteInput.directory}/${retained.id}.md`).exists()).toBe(false);
	});

	test("returns not_found for missing files", async () => {
		const result = await deleteEntry(baseWriteInput.directory, "missing");
		expect(result).toEqual({ status: "not_found", id: "missing" });
	});
});

describe("collectTags", () => {
	test("returns lowercased unique tags sorted alphabetically", async () => {
		await writeEntry({ ...baseWriteInput, content: "One", tags: ["Deploy", "Auth"] });
		await writeEntry({ ...baseWriteInput, content: "Two", tags: ["debug", "auth"] });

		const result = await collectTags(baseWriteInput.directory);
		expect(result).toEqual({ tags: ["auth", "debug", "deploy"], count: 3 });
	});

	test("returns empty when directory is missing", async () => {
		const result = await collectTags(`${TEST_DIR}/missing-tags`);
		expect(result).toEqual({ tags: [], count: 0 });
	});
});
