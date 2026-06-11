import { isValidSnowflake, snowflake } from "@kaged/utils";

export type MemoryId = string & { readonly __memoryIdBrand: unique symbol };

export function generateMemoryId(): MemoryId {
	return snowflake() as MemoryId;
}

export function isValidMemoryId(value: string): value is MemoryId {
	return isValidSnowflake(value);
}
