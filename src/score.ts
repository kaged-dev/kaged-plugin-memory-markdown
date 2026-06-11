import type { MemoryEntry } from "./frontmatter.ts";

const STOPWORDS: ReadonlySet<string> = new Set([
	"a",
	"an",
	"and",
	"as",
	"at",
	"be",
	"but",
	"by",
	"for",
	"from",
	"if",
	"in",
	"is",
	"it",
	"its",
	"no",
	"not",
	"of",
	"on",
	"or",
	"so",
	"that",
	"the",
	"this",
	"to",
	"was",
	"were",
	"will",
	"with",
]);

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;
export interface ScoreOptions {
	now: number;
	score_recency_24h: number;
	score_recency_7d: number;
	score_tag_exact: number;
}

export function tokenizeQuery(query: string): string[] {
	const normalized = query.toLowerCase().replace(/[^a-z0-9\s]+/g, " ");
	const seen = new Set<string>();
	const result: string[] = [];
	for (const token of normalized.split(/\s+/)) {
		if (!token || STOPWORDS.has(token)) continue;
		if (seen.has(token)) continue;
		seen.add(token);
		result.push(token);
	}
	return result;
}

export function scoreRecall(entry: MemoryEntry, query: string, options: ScoreOptions): number {
	const tokens = tokenizeQuery(query);

	let score = 0;
	score += keywordScore(entry, tokens);
	score += tagExactMatchScore(entry, tokens, options.score_tag_exact);
	score += recencyBoost(entry, options.now, options.score_recency_24h, options.score_recency_7d);
	return score;
}

function keywordScore(entry: MemoryEntry, tokens: readonly string[]): number {
	if (tokens.length === 0) return 0;
	const haystacks: string[] = [entry.body.toLowerCase()];
	if (entry.context) haystacks.push(entry.context.toLowerCase());
	if (entry.tags && entry.tags.length > 0) {
		haystacks.push(entry.tags.map((t) => t.toLowerCase()).join(" "));
	}

	let score = 0;
	for (const token of tokens) {
		for (const haystack of haystacks) {
			if (haystack.includes(token)) {
				score += 1;
			}
		}
	}
	return score;
}

function tagExactMatchScore(
	entry: MemoryEntry,
	tokens: readonly string[],
	tagExactMatchBoost: number,
): number {
	if (!entry.tags || entry.tags.length === 0) return 0;
	if (tokens.length === 0) return 0;
	const lowerTags = new Set(entry.tags.map((t) => t.toLowerCase()));
	let boost = 0;
	for (const token of tokens) {
		if (lowerTags.has(token)) {
			boost += tagExactMatchBoost;
		}
	}
	return boost;
}

function recencyBoost(
	entry: MemoryEntry,
	now: number,
	recent24hBoost: number,
	recent7dBoost: number,
): number {
	const created = Date.parse(entry.created_at);
	if (Number.isNaN(created)) return 0;
	const ageMs = now - created;
	if (ageMs <= ONE_DAY_MS) return recent24hBoost;
	if (ageMs <= 7 * ONE_DAY_MS) return recent7dBoost;
	return 0;
}
