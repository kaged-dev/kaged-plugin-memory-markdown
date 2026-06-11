import { describe, expect, test } from "bun:test";
import { resolveStoreDirectory } from "../src/storage.ts";

describe("resolveStoreDirectory", () => {
	describe("isolation: agent", () => {
		test("primary agent maps to <store>/agent/", () => {
			const result = resolveStoreDirectory({
				store: "/var/kaged/memory",
				agentPath: "primary",
				isolation: "agent",
			});
			expect(result).toEqual({ directory: "/var/kaged/memory/agent" });
		});

		test("direct subagent maps to <store>/subagent/<key>/", () => {
			const result = resolveStoreDirectory({
				store: "/var/kaged/memory",
				agentPath: "primary.subagents.researcher",
				isolation: "agent",
			});
			expect(result).toEqual({ directory: "/var/kaged/memory/subagent/researcher" });
		});

		test("nested subagent (two levels) maps to <store>/subagent/<parent>.<child>/", () => {
			const result = resolveStoreDirectory({
				store: "/var/kaged/memory",
				agentPath: "primary.subagents.researcher.subagents.scraper",
				isolation: "agent",
			});
			expect(result).toEqual({ directory: "/var/kaged/memory/subagent/researcher.scraper" });
		});

		test("deeply nested subagent (three levels) flattens with dots", () => {
			const result = resolveStoreDirectory({
				store: "/var/kaged/memory",
				agentPath: "primary.subagents.alpha.subagents.beta.subagents.gamma",
				isolation: "agent",
			});
			expect(result).toEqual({
				directory: "/var/kaged/memory/subagent/alpha.beta.gamma",
			});
		});

		test("trailing slash on store is normalized away", () => {
			const result = resolveStoreDirectory({
				store: "/var/kaged/memory/",
				agentPath: "primary",
				isolation: "agent",
			});
			expect(result).toEqual({ directory: "/var/kaged/memory/agent" });
		});
	});

	describe("isolation: project", () => {
		test("primary agent maps to <store>/project/ regardless of agent path", () => {
			const result = resolveStoreDirectory({
				store: "/var/kaged/memory",
				agentPath: "primary",
				isolation: "project",
			});
			expect(result).toEqual({ directory: "/var/kaged/memory/project" });
		});

		test("subagent under project isolation also maps to <store>/project/", () => {
			const result = resolveStoreDirectory({
				store: "/var/kaged/memory",
				agentPath: "primary.subagents.researcher",
				isolation: "project",
			});
			expect(result).toEqual({ directory: "/var/kaged/memory/project" });
		});

		test("nested subagent under project isolation also maps to <store>/project/", () => {
			const result = resolveStoreDirectory({
				store: "/var/kaged/memory",
				agentPath: "primary.subagents.researcher.subagents.scraper",
				isolation: "project",
			});
			expect(result).toEqual({ directory: "/var/kaged/memory/project" });
		});
	});

	describe("validation", () => {
		test("agent path that does not start with 'primary' throws", () => {
			expect(() =>
				resolveStoreDirectory({
					store: "/var/kaged/memory",
					agentPath: "researcher",
					isolation: "agent",
				}),
			).toThrow(/agent path must start with "primary"/i);
		});

		test("agent path with malformed segment delimiters throws", () => {
			expect(() =>
				resolveStoreDirectory({
					store: "/var/kaged/memory",
					agentPath: "primary.researcher",
					isolation: "agent",
				}),
			).toThrow(/malformed agent path/i);
		});

		test("agent path containing 'subagents' without a following key throws", () => {
			expect(() =>
				resolveStoreDirectory({
					store: "/var/kaged/memory",
					agentPath: "primary.subagents",
					isolation: "agent",
				}),
			).toThrow(/malformed agent path/i);
		});

		test("empty store throws", () => {
			expect(() =>
				resolveStoreDirectory({
					store: "",
					agentPath: "primary",
					isolation: "agent",
				}),
			).toThrow(/store/i);
		});

		test("invalid isolation value throws", () => {
			expect(() =>
				resolveStoreDirectory({
					store: "/var/kaged/memory",
					agentPath: "primary",
					isolation: "world" as never,
				}),
			).toThrow(/isolation/i);
		});
	});
});
