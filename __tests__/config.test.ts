import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CONFIG,
	type MarkdownConfig,
	type MarkdownSystemConfig,
	mergeConfig,
} from "../src/config.ts";

describe("mergeConfig", () => {
	test("applies defaults when no overrides are provided", () => {
		expect(mergeConfig()).toEqual(DEFAULT_CONFIG);
	});

	test("merges project and system config and clones tags", () => {
		const projectConfig: Partial<MarkdownConfig> = {
			tags: ["auth", "deploy"],
			custom_inject_header: "Relevant prior context:",
			score_tag_exact: 5,
		};
		const systemConfig: Partial<MarkdownSystemConfig> = {
			encryption_key: "secret-key",
		};

		const merged = mergeConfig(projectConfig, systemConfig);
		projectConfig.tags?.push("mutated");

		expect(merged.tags).toEqual(["auth", "deploy"]);
		expect(merged.custom_inject_header).toBe("Relevant prior context:");
		expect(merged.score_tag_exact).toBe(5);
		expect(merged.encryption_key).toBe("secret-key");
	});
});
