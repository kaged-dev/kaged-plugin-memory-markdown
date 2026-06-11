import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { DEFAULT_CONFIG, type MarkdownConfig } from "../src/config.ts";
import { parseEntryFile } from "../src/frontmatter.ts";
import {
	type HandlerContext,
	handleForget,
	handleListTags,
	handleOnCompact,
	handleOnSessionIdle,
	handleOnSessionStart,
	handleRecall,
	handleRetain,
} from "../src/handlers.ts";
import { isValidMemoryId } from "../src/id.ts";

const TEST_DIR = "/tmp/kaged-memory-markdown-handlers-test";

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

const baseResolve = {
	project_id: "proj_test",
	project_root: `${TEST_DIR}/project`,
	config_root: TEST_DIR,
};

const baseCtx: HandlerContext = {
	resolve: baseResolve,
	agent_path: "primary",
	session_id: "ses_abc123",
	operator_id: "ashley",
};

function configWith(overrides: Partial<MarkdownConfig>): MarkdownConfig {
	return { ...DEFAULT_CONFIG, ...overrides };
}

describe("handleRetain", () => {
	test("writes entry and returns stored result with valid snowflake ID", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		const result = await handleRetain(config, ctx, {
			content: "NTP fixes clock skew",
		});
		expect(result.status).toBe("stored");
		expect(isValidMemoryId(result.id)).toBe(true);
	});

	test("merges config.tags with params.tags", async () => {
		const config = configWith({
			store: `project:/${TEST_DIR}/mem`,
			tags: ["default-tag"],
		});
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		const result = await handleRetain(config, ctx, {
			content: "A fact",
			tags: ["user-tag"],
		});

		const dir = `${TEST_DIR}/mem/agent`;
		const content = await Bun.file(`${dir}/${result.id}.md`).text();
		const entry = parseEntryFile(content);
		expect(entry.tags).toEqual(["default-tag", "user-tag"]);
	});

	test("uses only config.tags when params.tags absent", async () => {
		const config = configWith({
			store: `project:/${TEST_DIR}/mem`,
			tags: ["project-tag"],
		});
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		const result = await handleRetain(config, ctx, { content: "A fact" });

		const dir = `${TEST_DIR}/mem/agent`;
		const content = await Bun.file(`${dir}/${result.id}.md`).text();
		const entry = parseEntryFile(content);
		expect(entry.tags).toEqual(["project-tag"]);
	});

	test("resolves config:/ store URI correctly", async () => {
		const config = configWith({ store: "config:/memory" });
		const result = await handleRetain(config, baseCtx, {
			content: "stored under config",
		});
		const expectedDir = `${TEST_DIR}/memory/proj_test/agent`;
		const file = Bun.file(`${expectedDir}/${result.id}.md`);
		expect(await file.exists()).toBe(true);
	});

	test("resolves subagent directory under agent isolation", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
			agent_path: "primary.subagents.researcher",
		};
		const result = await handleRetain(config, ctx, { content: "sub fact" });
		const file = Bun.file(`${TEST_DIR}/mem/subagent/researcher/${result.id}.md`);
		expect(await file.exists()).toBe(true);
	});

	test("resolves project isolation to shared directory", async () => {
		const config = configWith({
			store: `project:/${TEST_DIR}/mem`,
			isolation: "project",
		});
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
			agent_path: "primary.subagents.researcher",
		};
		const result = await handleRetain(config, ctx, { content: "shared fact" });
		const file = Bun.file(`${TEST_DIR}/mem/project/${result.id}.md`);
		expect(await file.exists()).toBe(true);
	});
});

describe("handleRecall", () => {
	async function seedAndRetain(config: MarkdownConfig, ctx: HandlerContext): Promise<void> {
		await handleRetain(config, ctx, { content: "JWT bug was clock skew", tags: ["auth"] });
		await handleRetain(config, ctx, { content: "Deploy target is CF Workers", tags: ["deploy"] });
		await handleRetain(config, ctx, { content: "Auth uses loopback cookie", tags: ["auth"] });
	}

	test("returns scored results for a query", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		await seedAndRetain(config, ctx);

		const result = await handleRecall(config, ctx, { query: "auth" });
		expect(result.count).toBeGreaterThan(0);
		expect(result.query).toBe("auth");
	});

	test("filters by tags", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		await seedAndRetain(config, ctx);

		const result = await handleRecall(config, ctx, {
			query: "anything",
			tags: ["deploy"],
		});
		expect(result.count).toBe(1);
		expect(result.results[0]?.tags).toContain("deploy");
	});

	test("respects max_results", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		await seedAndRetain(config, ctx);

		const result = await handleRecall(config, ctx, {
			query: "auth",
			max_results: 1,
		});
		expect(result.count).toBe(1);
	});

	test("returns empty for fresh store", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/empty` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		const result = await handleRecall(config, ctx, { query: "anything" });
		expect(result.count).toBe(0);
	});
});

describe("handleForget", () => {
	test("deletes an existing memory entry", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};

		const retained = await handleRetain(config, ctx, { content: "Delete me" });
		const result = await handleForget(config, ctx, { id: retained.id });

		expect(result).toEqual({ status: "forgotten", id: retained.id });
		expect(await Bun.file(`${TEST_DIR}/mem/agent/${retained.id}.md`).exists()).toBe(false);
	});

	test("returns not_found for missing IDs", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};

		const result = await handleForget(config, ctx, { id: "missing" });
		expect(result).toEqual({ status: "not_found", id: "missing" });
	});
});

describe("handleListTags", () => {
	test("collects unique tags in alphabetical lowercase order", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};

		await handleRetain(config, ctx, { content: "One", tags: ["Deploy", "Auth"] });
		await handleRetain(config, ctx, { content: "Two", tags: ["auth", "Debug"] });

		const result = await handleListTags(config, ctx);
		expect(result).toEqual({ tags: ["auth", "debug", "deploy"], count: 3 });
	});
});

describe("handleOnSessionStart", () => {
	test("ensures store ready and returns inject when entries exist", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};

		await handleRetain(config, ctx, { content: "JWT is clock skew", tags: ["auth"] });

		const result = await handleOnSessionStart(config, ctx);
		expect(result.inject).toBeDefined();
		expect(result.inject).toContain("Known about this project:");
		expect(result.inject).toContain("JWT is clock skew");
	});

	test("returns empty object when no entries exist", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/empty` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		const result = await handleOnSessionStart(config, ctx);
		expect(result.inject).toBeUndefined();
	});

	test("creates README.md at store root", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/readme-test` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		await handleOnSessionStart(config, ctx);
		const readme = await Bun.file(`${TEST_DIR}/readme-test/README.md`).text();
		expect(readme).toContain("proj_test");
	});

	test("respects inject_on_session_start_max_entries", async () => {
		const config = configWith({
			store: `project:/${TEST_DIR}/mem`,
			inject_on_session_start_max_entries: 1,
		});
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		await handleRetain(config, ctx, { content: "Fact one" });
		await handleRetain(config, ctx, { content: "Fact two" });

		const result = await handleOnSessionStart(config, ctx);
		const bulletCount = (result.inject ?? "").split("\n- ").length - 1;
		expect(bulletCount).toBe(1);
	});

	test("excludes transcript-kind entries from injection", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};

		await handleRetain(config, ctx, { content: "A retained fact" });
		await handleOnSessionIdle(config, ctx, { transcript: "full session transcript" });

		const result = await handleOnSessionStart(config, ctx);
		expect(result.inject).toContain("A retained fact");
		expect(result.inject).not.toContain("full session transcript");
	});
});

describe("handleOnSessionIdle", () => {
	test("writes transcript to transcripts/ directory", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		await handleOnSessionIdle(config, ctx, {
			transcript: "**Operator:** fix it\n**Agent:** done",
		});

		const file = Bun.file(`${TEST_DIR}/mem/agent/transcripts/ses_abc123.md`);
		expect(await file.exists()).toBe(true);
		const content = await file.text();
		const entry = parseEntryFile(content);
		expect(entry.kind).toBe("transcript");
		expect(entry.body).toContain("**Operator:** fix it");
	});

	test("is a no-op when retain_on_session_idle is false", async () => {
		const config = configWith({
			store: `project:/${TEST_DIR}/mem`,
			retain_on_session_idle: false,
		});
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		await handleOnSessionIdle(config, ctx, { transcript: "should not be saved" });

		const dir = `${TEST_DIR}/mem/agent/transcripts`;
		expect(existsSync(dir)).toBe(false);
	});

	test("upserts same session — second call overwrites", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		await handleOnSessionIdle(config, ctx, { transcript: "version one" });
		await handleOnSessionIdle(config, ctx, { transcript: "version two" });

		const content = await Bun.file(`${TEST_DIR}/mem/agent/transcripts/ses_abc123.md`).text();
		expect(content).toContain("version two");
		expect(content).not.toContain("version one");
	});
});

describe("handleOnCompact", () => {
	test("preserves compacted messages on disk and returns inject", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};

		await handleRetain(config, ctx, { content: "Prior knowledge" });

		const result = await handleOnCompact(config, ctx, {
			messages_being_compacted: "old messages being dropped",
			messages_remaining: "what's left after compaction",
			strategy: "summarize",
			trigger: "token_limit",
		});

		expect(result.retain).toEqual([]);
		expect(result.inject).toBeDefined();
		expect(result.inject).toContain("Known about this project:");
		expect(result.inject).toContain("Prior knowledge");
	});

	test("writes compact-chunk transcript file", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/mem` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		await handleOnCompact(config, ctx, {
			messages_being_compacted: "dropped content",
			messages_remaining: "remaining content",
			strategy: "drop",
			trigger: "manual",
		});

		const glob = new Bun.Glob("ses_abc123-compact-*.md");
		const transcriptDir = `${TEST_DIR}/mem/agent/transcripts`;
		let found = false;
		for await (const f of glob.scan({ cwd: transcriptDir, onlyFiles: true })) {
			found = true;
			const content = await Bun.file(`${transcriptDir}/${f}`).text();
			const entry = parseEntryFile(content);
			expect(entry.kind).toBe("transcript");
			expect(entry.body).toContain("dropped content");
			expect(entry.context).toContain("strategy=drop");
			expect(entry.context).toContain("trigger=manual");
		}
		expect(found).toBe(true);
	});

	test("returns no inject when store is empty", async () => {
		const config = configWith({ store: `project:/${TEST_DIR}/empty` });
		const ctx: HandlerContext = {
			...baseCtx,
			resolve: { ...baseResolve, project_root: "/" },
		};
		const result = await handleOnCompact(config, ctx, {
			messages_being_compacted: "dropped",
			messages_remaining: "remaining",
			strategy: "drop",
			trigger: "manual",
		});

		expect(result.retain).toEqual([]);
		expect(result.inject).toBeUndefined();
	});
});

describe("DEFAULT_CONFIG", () => {
	test("matches spec defaults", () => {
		expect(DEFAULT_CONFIG.store).toBe("config:/memory");
		expect(DEFAULT_CONFIG.isolation).toBe("agent");
		expect(DEFAULT_CONFIG.tags).toEqual([]);
		expect(DEFAULT_CONFIG.retain_on_session_idle).toBe(true);
		expect(DEFAULT_CONFIG.inject_on_session_start_max_entries).toBe(10);
		expect(DEFAULT_CONFIG.max_content_bytes).toBe(102400);
		expect(DEFAULT_CONFIG.fact_max_length).toBe(200);
		expect(DEFAULT_CONFIG.inject_tag_hint).toBe(true);
		expect(DEFAULT_CONFIG.score_recency_24h).toBe(2);
		expect(DEFAULT_CONFIG.score_recency_7d).toBe(1);
		expect(DEFAULT_CONFIG.score_tag_exact).toBe(3);
		expect(DEFAULT_CONFIG.debug).toBe(false);
		expect(DEFAULT_CONFIG.store_description).toBe("");
		expect(DEFAULT_CONFIG.custom_inject_header).toBe("Known about this project:");
	});
});
