import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { PluginServer } from "../src/server.ts";

function requireValue<T>(value: T | null | undefined): T {
	expect(value).toBeDefined();
	if (value === null || value === undefined) {
		throw new Error("Expected value to be defined");
	}
	return value;
}

const TEST_DIR = "/tmp/kaged-memory-markdown-server-test";

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

interface CollectedResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

function createServer(configOverrides?: Record<string, unknown>) {
	const responses: CollectedResponse[] = [];
	const server = new PluginServer({
		write: (line) => responses.push(JSON.parse(line)),
		resolve: {
			project_id: "proj_test",
			project_root: "/",
			config_root: TEST_DIR,
		},
		config: {
			store: `project:/${TEST_DIR}/mem`,
			...configOverrides,
		},
	});
	return { server, responses };
}

function req(id: number, method: string, params?: Record<string, unknown>): string {
	return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function notification(method: string, params?: Record<string, unknown>): string {
	return JSON.stringify({ jsonrpc: "2.0", method, params });
}

const CTX = {
	_context: {
		operator_id: "ashley",
		project_id: "proj_test",
		agent_path: "primary",
		session_id: "ses_abc123",
		request_id: "req_001",
	},
};

describe("initialize handshake", () => {
	test("responds with name, version, api_version, methods", async () => {
		const { server, responses } = createServer();
		await server.handleLine(
			req(1, "initialize", {
				daemon_version: "0.1.0",
				api_version: 1,
				plugin_name: "memory-markdown",
				storage_available: true,
				projects: ["proj_test"],
			}),
		);
		expect(responses.length).toBe(1);
		const r = requireValue(responses[0]);
		expect(r.id).toBe(1);
		expect(r.result).toEqual({
			name: "memory-markdown",
			version: "0.1.0",
			api_version: 1,
			methods: [
				"memory-markdown.retain",
				"memory-markdown.recall",
				"memory-markdown.forget",
				"memory-markdown.list_tags",
			],
			notifications: [],
			capabilities_used: ["kaged:storage:read"],
		});
	});

	test("initialized notification is accepted silently", async () => {
		const { server, responses } = createServer();
		await server.handleLine(notification("initialized", {}));
		expect(responses.length).toBe(0);
	});
});

describe("ping", () => {
	test("responds with status ok", async () => {
		const { server, responses } = createServer();
		await server.handleLine(req(2, "ping"));
		expect(responses[0]?.result).toEqual({ status: "ok" });
	});
});

describe("shutdown", () => {
	test("responds with status ok", async () => {
		const { server, responses } = createServer();
		await server.handleLine(req(3, "shutdown"));
		expect(responses[0]?.result).toEqual({ status: "ok" });
	});
});

describe("memory-markdown.retain", () => {
	test("stores entry and returns stored result", async () => {
		const { server, responses } = createServer();
		await server.handleLine(
			req(10, "memory-markdown.retain", {
				content: "NTP fixes clock skew",
				tags: ["auth"],
				...CTX,
			}),
		);
		const r = requireValue(responses[0]);
		expect(r.error).toBeUndefined();
		const result = r.result as { status: string; id: string };
		expect(result.status).toBe("stored");
		expect(typeof result.id).toBe("string");
	});

	test("rejects missing content with -32602", async () => {
		const { server, responses } = createServer();
		await server.handleLine(req(11, "memory-markdown.retain", { ...CTX }));
		expect(responses[0]?.error?.code).toBe(-32602);
		expect(responses[0]?.error?.message).toContain("content");
	});

	test("rejects content > 100KB with plugin error", async () => {
		const { server, responses } = createServer();
		await server.handleLine(
			req(12, "memory-markdown.retain", {
				content: "x".repeat(100 * 1024 + 1),
				...CTX,
			}),
		);
		expect(responses[0]?.error?.code).toBe(-32000);
		expect((responses[0]?.error?.data as Record<string, unknown>)?.code).toBe("content_too_large");
	});

	test("passes context and tags correctly", async () => {
		const { server, responses } = createServer();
		await server.handleLine(
			req(13, "memory-markdown.retain", {
				content: "A fact with context",
				context: "from session",
				tags: ["deploy"],
				...CTX,
			}),
		);
		expect(responses[0]?.error).toBeUndefined();
		expect((responses[0]?.result as { status: string }).status).toBe("stored");
	});
});

describe("memory-markdown.recall", () => {
	test("returns recall results", async () => {
		const { server, responses } = createServer();

		await server.handleLine(
			req(20, "memory-markdown.retain", {
				content: "JWT bug was clock skew",
				tags: ["auth"],
				...CTX,
			}),
		);
		responses.length = 0;

		await server.handleLine(
			req(21, "memory-markdown.recall", {
				query: "jwt",
				...CTX,
			}),
		);

		const r = requireValue(responses[0]);
		expect(r.error).toBeUndefined();
		const result = r.result as { count: number; query: string; results: unknown[] };
		expect(result.count).toBeGreaterThan(0);
		expect(result.query).toBe("jwt");
	});

	test("rejects missing query with -32602", async () => {
		const { server, responses } = createServer();
		await server.handleLine(req(22, "memory-markdown.recall", { ...CTX }));
		expect(responses[0]?.error?.code).toBe(-32602);
		expect(responses[0]?.error?.message).toContain("query");
	});

	test("returns empty for fresh store", async () => {
		const { server, responses } = createServer({
			store: `project:/${TEST_DIR}/empty`,
		});
		await server.handleLine(req(23, "memory-markdown.recall", { query: "anything", ...CTX }));
		const result = responses[0]?.result as { count: number };
		expect(result.count).toBe(0);
	});

	test("filters by tags", async () => {
		const { server, responses } = createServer();

		await server.handleLine(
			req(30, "memory-markdown.retain", {
				content: "Auth fact",
				tags: ["auth"],
				...CTX,
			}),
		);
		await server.handleLine(
			req(31, "memory-markdown.retain", {
				content: "Deploy fact",
				tags: ["deploy"],
				...CTX,
			}),
		);
		responses.length = 0;

		await server.handleLine(
			req(32, "memory-markdown.recall", {
				query: "fact",
				tags: ["deploy"],
				...CTX,
			}),
		);

		const result = responses[0]?.result as { count: number; results: { tags: string[] }[] };
		expect(result.count).toBe(1);
		expect(result.results[0]?.tags).toContain("deploy");
	});
});

describe("memory-markdown.forget", () => {
	test("deletes an existing entry", async () => {
		const { server, responses } = createServer();

		await server.handleLine(
			req(33, "memory-markdown.retain", {
				content: "Forgettable fact",
				...CTX,
			}),
		);
		const retainResult = responses[0]?.result as { id: string };
		responses.length = 0;

		await server.handleLine(
			req(34, "memory-markdown.forget", {
				id: retainResult.id,
				...CTX,
			}),
		);

		expect(responses[0]?.result).toEqual({ status: "forgotten", id: retainResult.id });
	});

	test("rejects missing id with -32602", async () => {
		const { server, responses } = createServer();
		await server.handleLine(req(35, "memory-markdown.forget", { ...CTX }));
		expect(responses[0]?.error?.code).toBe(-32602);
	});
});

describe("memory-markdown.list_tags", () => {
	test("returns unique lowercased tags", async () => {
		const { server, responses } = createServer();

		await server.handleLine(
			req(36, "memory-markdown.retain", {
				content: "Auth fact",
				tags: ["Auth", "Deploy"],
				...CTX,
			}),
		);
		await server.handleLine(
			req(37, "memory-markdown.retain", {
				content: "Debug fact",
				tags: ["debug", "auth"],
				...CTX,
			}),
		);
		responses.length = 0;

		await server.handleLine(req(38, "memory-markdown.list_tags", { ...CTX }));

		expect(responses[0]?.result).toEqual({
			tags: ["auth", "debug", "deploy"],
			count: 3,
		});
	});
});

describe("kaged.hook.on_session_start", () => {
	test("returns inject when entries exist", async () => {
		const { server, responses } = createServer();

		await server.handleLine(
			req(40, "memory-markdown.retain", {
				content: "Prior knowledge",
				...CTX,
			}),
		);
		responses.length = 0;

		await server.handleLine(req(41, "kaged.hook.on_session_start", { ...CTX }));

		const r = requireValue(responses[0]);
		expect(r.error).toBeUndefined();
		const result = r.result as { inject?: string };
		expect(result.inject).toContain("Known about this project:");
		expect(result.inject).toContain("Prior knowledge");
	});

	test("returns empty object when no entries", async () => {
		const { server, responses } = createServer({
			store: `project:/${TEST_DIR}/fresh`,
		});
		await server.handleLine(req(42, "kaged.hook.on_session_start", { ...CTX }));
		const result = responses[0]?.result as Record<string, unknown>;
		expect(result.inject).toBeUndefined();
	});
});

describe("kaged.hook.on_session_idle", () => {
	test("writes transcript and returns null", async () => {
		const { server, responses } = createServer();
		await server.handleLine(
			req(50, "kaged.hook.on_session_idle", {
				transcript: "**Operator:** fix it\n**Agent:** done",
				...CTX,
			}),
		);
		expect(responses[0]?.result).toBeNull();

		const file = Bun.file(`${TEST_DIR}/mem/agent/transcripts/ses_abc123.md`);
		expect(await file.exists()).toBe(true);
	});

	test("is a no-op when retain_on_session_idle is false", async () => {
		const { server, responses } = createServer({
			store: `project:/${TEST_DIR}/mem-noop`,
			retain_on_session_idle: false,
		});
		await server.handleLine(
			req(51, "kaged.hook.on_session_idle", {
				transcript: "should not be saved",
				...CTX,
			}),
		);
		expect(responses[0]?.result).toBeNull();
		expect(existsSync(`${TEST_DIR}/mem-noop/agent/transcripts`)).toBe(false);
	});
});

describe("kaged.hook.post_compact", () => {
	test("preserves compacted messages and returns inject", async () => {
		const { server, responses } = createServer();

		await server.handleLine(
			req(60, "memory-markdown.retain", {
				content: "Prior context",
				...CTX,
			}),
		);
		responses.length = 0;

		await server.handleLine(
			req(61, "kaged.hook.post_compact", {
				messages_being_compacted: "old messages",
				messages_remaining: "remaining",
				strategy: "summarize",
				trigger: "token_limit",
				...CTX,
			}),
		);

		const r = requireValue(responses[0]);
		expect(r.error).toBeUndefined();
		const result = r.result as { retain: never[]; inject?: string };
		expect(result.retain).toEqual([]);
		expect(result.inject).toContain("Prior context");
	});
});

describe("unknown method", () => {
	test("returns -32601 method not found", async () => {
		const { server, responses } = createServer();
		await server.handleLine(req(70, "bogus.method"));
		expect(responses[0]?.error?.code).toBe(-32601);
	});
});

describe("unknown hook", () => {
	test("returns -32601 for unrecognized hook name", async () => {
		const { server, responses } = createServer();
		await server.handleLine(req(71, "kaged.hook.on_bogus", { ...CTX }));
		expect(responses[0]?.error?.code).toBe(-32601);
	});
});

describe("malformed input", () => {
	test("parse error on invalid JSON", async () => {
		const { server, responses } = createServer();
		await server.handleLine("not json at all");
		expect(responses[0]?.error?.code).toBe(-32700);
	});

	test("invalid request on non-object", async () => {
		const { server, responses } = createServer();
		await server.handleLine(JSON.stringify([1, 2, 3]));
		expect(responses[0]?.error?.code).toBe(-32600);
	});

	test("invalid request on missing jsonrpc field", async () => {
		const { server, responses } = createServer();
		await server.handleLine(JSON.stringify({ id: 1, method: "ping" }));
		expect(responses[0]?.error?.code).toBe(-32600);
	});

	test("empty line is silently ignored", async () => {
		const { server, responses } = createServer();
		await server.handleLine("");
		await server.handleLine("   ");
		expect(responses.length).toBe(0);
	});
});

describe("context extraction", () => {
	test("uses defaults when _context is missing", async () => {
		const { server, responses } = createServer();
		await server.handleLine(req(80, "memory-markdown.retain", { content: "no context field" }));
		expect(responses[0]?.error).toBeUndefined();
		const result = responses[0]?.result as { status: string };
		expect(result.status).toBe("stored");
	});
});
