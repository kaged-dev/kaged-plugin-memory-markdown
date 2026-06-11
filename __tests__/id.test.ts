import { describe, expect, test } from "bun:test";
import { generateMemoryId, isValidMemoryId } from "../src/id.ts";

describe("generateMemoryId", () => {
	test("returns a 16-character hex string", () => {
		const id = generateMemoryId();
		expect(id).toMatch(/^[0-9a-f]{16}$/);
	});

	test("generates unique IDs on rapid successive calls", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 1000; i++) {
			ids.add(generateMemoryId());
		}
		expect(ids.size).toBe(1000);
	});

	test("IDs generated in sequence sort lexicographically by creation order", () => {
		const ids: string[] = [];
		for (let i = 0; i < 100; i++) {
			ids.push(generateMemoryId());
		}
		const sorted = [...ids].sort();
		expect(sorted).toEqual(ids);
	});

	test("IDs generated across a delay still sort by creation order", async () => {
		const earlier = generateMemoryId();
		await new Promise((r) => setTimeout(r, 5));
		const later = generateMemoryId();
		expect(later > earlier).toBe(true);
	});
});

describe("isValidMemoryId", () => {
	test("accepts a freshly generated ID", () => {
		expect(isValidMemoryId(generateMemoryId())).toBe(true);
	});

	test("accepts a literal 16-hex string", () => {
		expect(isValidMemoryId("0034f8b2e1d40000")).toBe(true);
	});

	test("rejects too-short strings", () => {
		expect(isValidMemoryId("0034f8b2")).toBe(false);
	});

	test("rejects too-long strings", () => {
		expect(isValidMemoryId("0034f8b2e1d4000000")).toBe(false);
	});

	test("rejects uppercase hex", () => {
		expect(isValidMemoryId("0034F8B2E1D40000")).toBe(false);
	});

	test("rejects non-hex characters", () => {
		expect(isValidMemoryId("0034f8b2e1d4000g")).toBe(false);
	});

	test("rejects empty string", () => {
		expect(isValidMemoryId("")).toBe(false);
	});
});
