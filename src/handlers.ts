import type { MarkdownConfig } from "./config.ts";
import { generateMemoryId } from "./id.ts";
import {
	collectTags,
	deleteEntry,
	ensureStoreReady,
	type ForgetResult,
	formatInjection,
	getRecentRetains,
	type ListTagsResult,
	type RecallResult,
	recall,
	type WriteEntryResult,
	writeEntry,
	writeTranscript,
} from "./io.ts";
import { resolveStoreDirectory } from "./storage.ts";
import { type ResolveContext, resolveStoreUri } from "./uri.ts";

export interface HandlerContext {
	resolve: ResolveContext;
	agent_path: string;
	session_id: string;
	operator_id: string;
}

// -- Tool params ---

export interface RetainParams {
	content: string;
	context?: string;
	tags?: string[];
}

export interface RecallParams {
	query: string;
	tags?: string[];
	max_results?: number;
}

export interface ForgetParams {
	id: string;
}

// -- Hook params ---

export interface OnSessionIdleParams {
	transcript: string;
}

export interface OnCompactParams {
	messages_being_compacted: string;
	messages_remaining: string;
	strategy: string;
	trigger: string;
}

// -- Hook results ---

export interface SessionStartResult {
	inject?: string;
}

export interface CompactResult {
	retain: never[];
	inject?: string;
}

// -- Shared resolution ---

function resolveDirectory(config: MarkdownConfig, ctx: HandlerContext): string {
	const storePath = resolveStoreUri(config.store, ctx.resolve);
	return resolveStoreDirectory({
		store: storePath,
		agentPath: ctx.agent_path,
		isolation: config.isolation,
	}).directory;
}

// -- Tool handlers ---

export async function handleRetain(
	config: MarkdownConfig,
	ctx: HandlerContext,
	params: RetainParams,
): Promise<WriteEntryResult> {
	const directory = resolveDirectory(config, ctx);

	const mergedTags =
		config.tags.length > 0 || (params.tags && params.tags.length > 0)
			? [...config.tags, ...(params.tags ?? [])]
			: undefined;

	return writeEntry({
		directory,
		content: params.content,
		context: params.context,
		tags: mergedTags,
		max_content_bytes: config.max_content_bytes,
		fact_max_length: config.fact_max_length,
		agent_path: ctx.agent_path,
		session_id: ctx.session_id,
		operator_id: ctx.operator_id,
	});
}

export async function handleRecall(
	config: MarkdownConfig,
	ctx: HandlerContext,
	params: RecallParams,
): Promise<RecallResult> {
	const directory = resolveDirectory(config, ctx);

	return recall({
		directory,
		query: params.query,
		tags: params.tags,
		max_results: params.max_results,
		score_recency_24h: config.score_recency_24h,
		score_recency_7d: config.score_recency_7d,
		score_tag_exact: config.score_tag_exact,
	});
}

export async function handleForget(
	config: MarkdownConfig,
	ctx: HandlerContext,
	params: ForgetParams,
): Promise<ForgetResult> {
	const directory = resolveDirectory(config, ctx);
	return deleteEntry(directory, params.id);
}

export async function handleListTags(
	config: MarkdownConfig,
	ctx: HandlerContext,
): Promise<ListTagsResult> {
	const directory = resolveDirectory(config, ctx);
	return collectTags(directory);
}

// -- Hook handlers ---

export async function handleOnSessionStart(
	config: MarkdownConfig,
	ctx: HandlerContext,
): Promise<SessionStartResult> {
	const storePath = resolveStoreUri(config.store, ctx.resolve);

	await ensureStoreReady({
		storeRoot: storePath,
		project_id: ctx.resolve.project_id,
		store_description: config.store_description,
	});

	const directory = resolveStoreDirectory({
		store: storePath,
		agentPath: ctx.agent_path,
		isolation: config.isolation,
	}).directory;

	const entries = await getRecentRetains(directory, config.inject_on_session_start_max_entries);
	const knownTags = config.inject_tag_hint ? await collectTags(directory) : { tags: [], count: 0 };

	const inject = formatInjection(entries, {
		header: config.custom_inject_header,
		inject_tag_hint: config.inject_tag_hint,
		known_tags: knownTags.tags,
	});
	return inject ? { inject } : {};
}

export async function handleOnSessionIdle(
	config: MarkdownConfig,
	ctx: HandlerContext,
	params: OnSessionIdleParams,
): Promise<void> {
	if (!config.retain_on_session_idle) return;

	const directory = resolveDirectory(config, ctx);

	await writeTranscript({
		directory,
		session_id: ctx.session_id,
		agent_path: ctx.agent_path,
		operator_id: ctx.operator_id,
		body: params.transcript,
	});
}

export async function handleOnCompact(
	config: MarkdownConfig,
	ctx: HandlerContext,
	params: OnCompactParams,
): Promise<CompactResult> {
	const directory = resolveDirectory(config, ctx);

	const compactId = generateMemoryId();
	await writeTranscript({
		directory,
		session_id: ctx.session_id,
		agent_path: ctx.agent_path,
		operator_id: ctx.operator_id,
		body: params.messages_being_compacted,
		compactId,
		context: `Compaction: strategy=${params.strategy}, trigger=${params.trigger}`,
	});

	const entries = await getRecentRetains(directory, config.inject_on_session_start_max_entries);

	const inject = formatInjection(entries, {
		header: config.custom_inject_header,
	});
	return inject ? { retain: [], inject } : { retain: [] };
}
