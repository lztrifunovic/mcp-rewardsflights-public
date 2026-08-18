import { describe, expect, it } from "vitest";
import {
	getBearerToken,
	isAllowedOrigin,
	secureTokenEqual,
	tokenFingerprint,
} from "./security";

describe("request security", () => {
	it("parses only a single Bearer credential", () => {
		expect(getBearerToken("Bearer secret-token")).toBe("secret-token");
		expect(getBearerToken("Basic secret-token")).toBeNull();
		expect(getBearerToken("Bearer two tokens")).toBeNull();
		expect(getBearerToken(null)).toBeNull();
	});

	it("permits native clients without Origin and allowlisted browser origins", () => {
		expect(isAllowedOrigin(null)).toBe(true);
		expect(
			isAllowedOrigin("https://app.example.com", "https://app.example.com"),
		).toBe(true);
		expect(
			isAllowedOrigin(
				"https://second.example.com",
				"https://app.example.com, https://second.example.com",
			),
		).toBe(true);
		expect(
			isAllowedOrigin("https://evil.example", "https://app.example.com"),
		).toBe(false);
		expect(isAllowedOrigin("https://app.example.com")).toBe(false);
	});

	it("compares credentials and produces stable, non-secret fingerprints", async () => {
		await expect(secureTokenEqual("same", "same")).resolves.toBe(true);
		await expect(secureTokenEqual("same", "different")).resolves.toBe(false);
		await expect(tokenFingerprint("secret")).resolves.toMatch(/^[a-f0-9]{32}$/);
		await expect(tokenFingerprint("secret")).resolves.not.toBe("secret");
	});
});
