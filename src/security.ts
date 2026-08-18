const encoder = new TextEncoder();

export function getBearerToken(authorization: string | null): string | null {
	if (!authorization) return null;
	const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
	return match?.[1] || null;
}

export function isAllowedOrigin(
	origin: string | null,
	configuredOrigins?: string,
): boolean {
	if (!origin) return true;
	if (!configuredOrigins) return false;

	const allowed = configuredOrigins
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
	return allowed.includes(origin);
}

async function digest(value: string): Promise<ArrayBuffer> {
	return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

export async function secureTokenEqual(
	candidate: string,
	expected: string,
): Promise<boolean> {
	const [candidateHash, expectedHash] = await Promise.all([
		digest(candidate),
		digest(expected),
	]);
	if (typeof crypto.subtle.timingSafeEqual === "function") {
		return crypto.subtle.timingSafeEqual(candidateHash, expectedHash);
	}

	// Node's Web Crypto lacks Cloudflare's helper. SHA-256 makes both inputs a
	// fixed length, so this fallback always performs the same amount of work.
	const candidateBytes = new Uint8Array(candidateHash);
	const expectedBytes = new Uint8Array(expectedHash);
	let difference = 0;
	for (let index = 0; index < candidateBytes.length; index += 1) {
		difference |= candidateBytes[index] ^ expectedBytes[index];
	}
	return difference === 0;
}

export async function tokenFingerprint(token: string): Promise<string> {
	const bytes = new Uint8Array(await digest(token));
	return Array.from(bytes.slice(0, 16), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}
