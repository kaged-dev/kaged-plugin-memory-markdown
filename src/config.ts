import type { Isolation } from "./storage.ts";

export interface MarkdownConfig {
	store: string;
	isolation: Isolation;
	tags: string[];
	retain_on_session_idle: boolean;
	inject_on_session_start_max_entries: number;
	max_content_bytes: number;
	fact_max_length: number;
	inject_tag_hint: boolean;
	score_recency_24h: number;
	score_recency_7d: number;
	score_tag_exact: number;
	debug: boolean;
	store_description: string;
	custom_inject_header: string;
}

export interface MarkdownSystemConfig {
	encryption_key?: string;
}

export interface RuntimeConfig extends MarkdownConfig, MarkdownSystemConfig {}

export const DEFAULT_CONFIG: MarkdownConfig = {
	store: "config:/memory",
	isolation: "agent",
	tags: [],
	retain_on_session_idle: true,
	inject_on_session_start_max_entries: 10,
	max_content_bytes: 100 * 1024,
	fact_max_length: 200,
	inject_tag_hint: true,
	score_recency_24h: 2,
	score_recency_7d: 1,
	score_tag_exact: 3,
	debug: false,
	store_description: "",
	custom_inject_header: "Known about this project:",
};

export function mergeConfig(
	projectConfig: Partial<MarkdownConfig> = {},
	systemConfig: Partial<MarkdownSystemConfig> = {},
): RuntimeConfig {
	return {
		...DEFAULT_CONFIG,
		...projectConfig,
		...systemConfig,
		tags: [...(projectConfig.tags ?? DEFAULT_CONFIG.tags)],
	};
}
