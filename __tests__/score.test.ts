import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../src/config.ts";
import type { MemoryEntry } from "../src/frontmatter.ts";
import { scoreRecall, tokenizeQuery } from "../src/score.ts";

const baseEntry: MemoryEntry = {
	id: "0034f8b2e1d40000",
	created_at: "2026-05-01T10:00:00.000Z",
	agent_path: "primary",
	session_id: "ses_abc",
	operator_id: "ashley",
	tags: ["auth", "jwt"],
	context: "debug session in #142",
	kind: "retain",
	body: "JWT expiry bug was clock skew. NTP fixes it.",
};

const NOW = new Date("2026-05-27T10:00:00.000Z").getTime();
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

function scoreOptions(now: number = NOW) {
	return {
		now,
		score_recency_24h: DEFAULT_CONFIG.score_recency_24h,
		score_recency_7d: DEFAULT_CONFIG.score_recency_7d,
		score_tag_exact: DEFAULT_CONFIG.score_tag_exact,
	};
}

describe("tokenizeQuery", () => {
	test("splits on whitespace and lowercases", () => {
		expect(tokenizeQuery("JWT Bug FIX")).toEqual(["jwt", "bug", "fix"]);
	});

	test("removes stopwords", () => {
		expect(tokenizeQuery("the bug and a fix")).toEqual(["bug", "fix"]);
	});

	test("returns empty array on whitespace-only input", () => {
		expect(tokenizeQuery("   \t  ")).toEqual([]);
	});

	test("strips punctuation", () => {
		expect(tokenizeQuery("clock-skew, again!")).toEqual(["clock", "skew", "again"]);
	});

	test("collapses repeated tokens", () => {
		expect(tokenizeQuery("bug bug bug")).toEqual(["bug"]);
	});
});

describe("scoreRecall", () => {
	describe("keyword score", () => {
		test("each query term matched in body scores 1", () => {
			const score = scoreRecall(baseEntry, "expiry clock", scoreOptions());
			expect(score).toBeGreaterThanOrEqual(2);
		});

		test("query terms matched in context score", () => {
			const score = scoreRecall(baseEntry, "debug session", scoreOptions());
			expect(score).toBeGreaterThanOrEqual(2);
		});

		test("query terms matched in tags also score keyword points", () => {
			const score = scoreRecall(baseEntry, "auth", scoreOptions());
			expect(score).toBeGreaterThan(0);
		});

		test("no matching terms scores 0 (with no recency boost)", () => {
			const old: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 30 * ONE_DAY_MS).toISOString(),
			};
			expect(scoreRecall(old, "unrelated topic", scoreOptions())).toBe(0);
		});
	});

	describe("recency boost", () => {
		test("entry within last 24h gets +2", () => {
			const fresh: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 1 * ONE_HOUR_MS).toISOString(),
			};
			const stale: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 30 * ONE_DAY_MS).toISOString(),
			};
			const freshScore = scoreRecall(fresh, "irrelevant", scoreOptions());
			const staleScore = scoreRecall(stale, "irrelevant", scoreOptions());
			expect(freshScore - staleScore).toBe(2);
		});

		test("entry within last 7 days (but >24h) gets +1", () => {
			const lastWeek: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 3 * ONE_DAY_MS).toISOString(),
			};
			const stale: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 30 * ONE_DAY_MS).toISOString(),
			};
			expect(
				scoreRecall(lastWeek, "irrelevant", scoreOptions()) -
					scoreRecall(stale, "irrelevant", scoreOptions()),
			).toBe(1);
		});

		test("entry older than 7 days gets +0 recency", () => {
			const old: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 30 * ONE_DAY_MS).toISOString(),
			};
			expect(scoreRecall(old, "irrelevant", scoreOptions())).toBe(0);
		});

		test("24h boundary is inclusive (exactly 24h ago is still +2)", () => {
			const exactly24h: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - ONE_DAY_MS).toISOString(),
			};
			const stale: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 30 * ONE_DAY_MS).toISOString(),
			};
			expect(
				scoreRecall(exactly24h, "irrelevant", scoreOptions()) -
					scoreRecall(stale, "irrelevant", scoreOptions()),
			).toBe(2);
		});
	});

	describe("tag exact-match boost", () => {
		test("query term matching a tag exactly gets +3 on top of keyword score", () => {
			const old: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 30 * ONE_DAY_MS).toISOString(),
				tags: ["auth", "jwt"],
				body: "unrelated body text",
				context: undefined,
			};
			// "auth" tokenizes to "auth"; matches tag exactly → +3
			// also matches once as keyword in tags → +1
			// total: 4
			expect(scoreRecall(old, "auth", scoreOptions())).toBe(4);
		});

		test("query terms not matching a tag get no tag boost", () => {
			const old: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 30 * ONE_DAY_MS).toISOString(),
				tags: ["auth", "jwt"],
				body: "expiry mentioned here",
				context: undefined,
			};
			// "expiry" matches body once → +1, no tag match → no boost
			expect(scoreRecall(old, "expiry", scoreOptions())).toBe(1);
		});

		test("tag match is case-insensitive (tag stored lowercase, query upper)", () => {
			const old: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 30 * ONE_DAY_MS).toISOString(),
				tags: ["auth"],
				body: "unrelated",
				context: undefined,
			};
			// "AUTH" tokenizes to "auth"; matches tag exactly → +3
			// plus keyword score in tags → +1 = 4
			expect(scoreRecall(old, "AUTH", scoreOptions())).toBe(4);
		});
	});

	describe("composite scoring", () => {
		test("body match + recency + tag boost compose", () => {
			const recentTagged: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 1 * ONE_HOUR_MS).toISOString(),
				tags: ["jwt"],
				body: "JWT bug fix",
				context: undefined,
			};
			// "jwt" matches body (lowercased "jwt") → +1
			//       matches tag (in tags array as keyword) → +1
			//       exact tag match → +3
			// recency (<24h) → +2
			// total: 7
			expect(scoreRecall(recentTagged, "jwt", scoreOptions())).toBe(7);
		});

		test("empty query returns recency boost only", () => {
			const fresh: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 1 * ONE_HOUR_MS).toISOString(),
			};
			expect(scoreRecall(fresh, "", scoreOptions())).toBe(2);
		});

		test("entry with no tags still scores keyword + recency", () => {
			const noTags: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 1 * ONE_HOUR_MS).toISOString(),
				tags: undefined,
				body: "jwt fix",
				context: undefined,
			};
			// keyword body match: 1
			// recency: 2
			expect(scoreRecall(noTags, "jwt", scoreOptions())).toBe(3);
		});

		test("uses configurable scoring weights", () => {
			const recentTagged: MemoryEntry = {
				...baseEntry,
				created_at: new Date(NOW - 1 * ONE_HOUR_MS).toISOString(),
				tags: ["jwt"],
				body: "JWT bug fix",
				context: undefined,
			};

			expect(
				scoreRecall(recentTagged, "jwt", {
					now: NOW,
					score_recency_24h: 5,
					score_recency_7d: 4,
					score_tag_exact: 7,
				}),
			).toBe(14);
		});
	});

	describe("idempotency", () => {
		test("calling scoreRecall twice with the same inputs returns the same score", () => {
			const a = scoreRecall(baseEntry, "jwt clock", scoreOptions());
			const b = scoreRecall(baseEntry, "jwt clock", scoreOptions());
			expect(a).toBe(b);
		});
	});
});
