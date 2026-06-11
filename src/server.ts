import { type MarkdownConfig, mergeConfig } from "./config.ts";
import {
	type ForgetParams,
	type HandlerContext,
	handleForget,
	handleListTags,
	handleOnCompact,
	handleOnSessionIdle,
	handleOnSessionStart,
	handleRecall,
	handleRetain,
	type OnCompactParams,
	type OnSessionIdleParams,
	type RecallParams,
	type RetainParams,
} from "./handlers.ts";
import { ContentTooLargeError } from "./io.ts";
import type { ResolveContext } from "./uri.ts";

// -- JSON-RPC wire types (minimal subset matching plugin-host) ---

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcSuccessResponse {
	jsonrpc: "2.0";
	id: number;
	result: unknown;
}

interface JsonRpcErrorResponse {
	jsonrpc: "2.0";
	id: number;
	error: { code: number; message: string; data?: unknown };
}

// -- Error codes ---

const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;
const ERR_INTERNAL = -32603;
const ERR_PLUGIN = -32000;

// -- Server config ---

export interface ServerDeps {
	write: (line: string) => void;
	resolve: ResolveContext;
	config?: Partial<MarkdownConfig>;
}

export class PluginServer {
	private readonly config: MarkdownConfig;
	private readonly resolve: ResolveContext;
	private readonly write: (line: string) => void;
	initialized: boolean = false;

	constructor(deps: ServerDeps) {
		this.config = mergeConfig(deps.config);
		this.resolve = deps.resolve;
		this.write = deps.write;
	}

	async handleLine(line: string): Promise<void> {
		const trimmed = line.trim();
		if (!trimmed) return;

		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			this.sendError(0, -32700, "Parse error");
			return;
		}

		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			this.sendError(0, -32600, "Invalid request");
			return;
		}

		const msg = parsed as Record<string, unknown>;

		if (msg.jsonrpc !== "2.0") {
			this.sendError(0, -32600, "Invalid request: missing jsonrpc 2.0");
			return;
		}

		const isNotification = !("id" in msg);
		if (isNotification) {
			this.handleNotification(msg);
			return;
		}

		const id = typeof msg.id === "number" ? msg.id : 0;
		const method = typeof msg.method === "string" ? msg.method : "";

		if (!method) {
			this.sendError(id, -32600, "Invalid request: missing method");
			return;
		}

		await this.handleRequest({
			jsonrpc: "2.0",
			id,
			method,
			params: (msg.params as Record<string, unknown>) ?? {},
		});
	}

	private handleNotification(msg: Record<string, unknown>): void {
		const method = msg.method as string;
		if (method === "initialized") {
			this.initialized = true;
		}
	}

	private async handleRequest(req: JsonRpcRequest): Promise<void> {
		try {
			switch (req.method) {
				case "initialize":
					this.handleInitialize(req);
					return;

				case "ping":
					this.sendResult(req.id, { status: "ok" });
					return;

				case "shutdown":
					this.sendResult(req.id, { status: "ok" });
					return;

				case "memory-markdown.retain":
					await this.handleToolRetain(req);
					return;

				case "memory-markdown.recall":
					await this.handleToolRecall(req);
					return;

				case "memory-markdown.forget":
					await this.handleToolForget(req);
					return;

				case "memory-markdown.list_tags":
					await this.handleToolListTags(req);
					return;

				default:
					if (req.method.startsWith("kaged.hook.")) {
						await this.handleHook(req);
						return;
					}
					this.sendError(req.id, ERR_METHOD_NOT_FOUND, `Method not found: ${req.method}`);
			}
		} catch (err) {
			this.handleUnexpectedError(req.id, err);
		}
	}

	private handleInitialize(req: JsonRpcRequest): void {
		this.sendResult(req.id, {
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
	}

	private async handleToolRetain(req: JsonRpcRequest): Promise<void> {
		const ctx = this.extractContext(req);
		const params = req.params ?? {};

		if (typeof params.content !== "string" || !params.content) {
			this.sendError(req.id, ERR_INVALID_PARAMS, "Missing required parameter: content");
			return;
		}

		const retainParams: RetainParams = {
			content: params.content,
			context: typeof params.context === "string" ? params.context : undefined,
			tags: Array.isArray(params.tags) ? (params.tags as string[]) : undefined,
		};

		try {
			const result = await handleRetain(this.config, ctx, retainParams);
			this.sendResult(req.id, result);
		} catch (err) {
			if (err instanceof ContentTooLargeError) {
				this.sendError(req.id, ERR_PLUGIN, err.message, {
					code: err.code,
					actual_bytes: err.actualBytes,
					max_bytes: err.maxBytes,
				});
				return;
			}
			throw err;
		}
	}

	private async handleToolRecall(req: JsonRpcRequest): Promise<void> {
		const ctx = this.extractContext(req);
		const params = req.params ?? {};

		if (typeof params.query !== "string" || !params.query) {
			this.sendError(req.id, ERR_INVALID_PARAMS, "Missing required parameter: query");
			return;
		}

		const recallParams: RecallParams = {
			query: params.query,
			tags: Array.isArray(params.tags) ? (params.tags as string[]) : undefined,
			max_results: typeof params.max_results === "number" ? params.max_results : undefined,
		};

		const result = await handleRecall(this.config, ctx, recallParams);
		this.sendResult(req.id, result);
	}

	private async handleToolForget(req: JsonRpcRequest): Promise<void> {
		const ctx = this.extractContext(req);
		const params = req.params ?? {};

		if (typeof params.id !== "string" || !params.id) {
			this.sendError(req.id, ERR_INVALID_PARAMS, "Missing required parameter: id");
			return;
		}

		const forgetParams: ForgetParams = { id: params.id };
		const result = await handleForget(this.config, ctx, forgetParams);
		this.sendResult(req.id, result);
	}

	private async handleToolListTags(req: JsonRpcRequest): Promise<void> {
		const ctx = this.extractContext(req);
		const result = await handleListTags(this.config, ctx);
		this.sendResult(req.id, result);
	}

	private async handleHook(req: JsonRpcRequest): Promise<void> {
		const hookName = req.method.slice("kaged.hook.".length);
		const ctx = this.extractContext(req);
		const params = req.params ?? {};

		switch (hookName) {
			case "on_session_start": {
				const result = await handleOnSessionStart(this.config, ctx);
				this.sendResult(req.id, result);
				return;
			}

			case "on_session_idle": {
				const idleParams: OnSessionIdleParams = {
					transcript: typeof params.transcript === "string" ? params.transcript : "",
				};
				await handleOnSessionIdle(this.config, ctx, idleParams);
				this.sendResult(req.id, null);
				return;
			}

			case "pre_compact": {
				this.sendResult(req.id, null);
				return;
			}

			case "post_compact": {
				const compactParams: OnCompactParams = {
					messages_being_compacted:
						typeof params.messages_being_compacted === "string"
							? params.messages_being_compacted
							: "",
					messages_remaining:
						typeof params.messages_remaining === "string" ? params.messages_remaining : "",
					strategy: typeof params.strategy === "string" ? params.strategy : "drop",
					trigger: typeof params.trigger === "string" ? params.trigger : "unknown",
				};
				const result = await handleOnCompact(this.config, ctx, compactParams);
				this.sendResult(req.id, result);
				return;
			}

			default:
				this.sendError(req.id, ERR_METHOD_NOT_FOUND, `Unknown hook: ${hookName}`);
		}
	}

	private extractContext(req: JsonRpcRequest): HandlerContext {
		const params = req.params ?? {};
		const _context = (params._context ?? {}) as Record<string, unknown>;

		const resolveOverride = { ...this.resolve };
		if (typeof _context.project_root === "string" && _context.project_root) {
			resolveOverride.project_root = _context.project_root;
		}

		return {
			resolve: resolveOverride,
			agent_path: typeof _context.agent_path === "string" ? _context.agent_path : "primary",
			session_id: typeof _context.session_id === "string" ? _context.session_id : "unknown",
			operator_id: typeof _context.operator_id === "string" ? _context.operator_id : "unknown",
		};
	}

	private sendResult(id: number, result: unknown): void {
		const response: JsonRpcSuccessResponse = { jsonrpc: "2.0", id, result };
		this.write(JSON.stringify(response));
	}

	private sendError(id: number, code: number, message: string, data?: unknown): void {
		const response: JsonRpcErrorResponse = {
			jsonrpc: "2.0",
			id,
			error: data !== undefined ? { code, message, data } : { code, message },
		};
		this.write(JSON.stringify(response));
	}

	private handleUnexpectedError(id: number, err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		this.sendError(id, ERR_INTERNAL, `Internal error: ${message}`);
	}
}
