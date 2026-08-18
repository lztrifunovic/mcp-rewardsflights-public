import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import {
	getBearerToken,
	isAllowedOrigin,
	secureTokenEqual,
	tokenFingerprint,
} from "./security";

interface WorkerEnv extends Env {
	MCP_ALLOWED_ORIGINS?: string;
	MCP_AUTH_TOKEN?: string;
	MCP_RATE_LIMITER: RateLimit;
	SEATS_AERO_API_KEY?: string;
}

type QueryParams = Record<string, string | number | boolean | null | undefined>;

interface SeatsAeroResponse {
	Cursor?: unknown;
	Results?: unknown[];
	TotalResults?: unknown;
	data?: unknown[];
	length?: number;
}

const SEATS_AERO_BASE_URL = "https://seats.aero/partnerapi";

const SOURCES: Record<string, string> = {
	eurobonus: "SAS EuroBonus",
	virginatlantic: "Virgin Atlantic Flying Club",
	aeromexico: "Aeromexico Club Premier",
	american: "American Airlines",
	delta: "Delta SkyMiles",
	etihad: "Etihad Guest",
	united: "United MileagePlus",
	emirates: "Emirates Skywards",
	aeroplan: "Air Canada Aeroplan",
	alaska: "Alaska Mileage Plan",
	velocity: "Virgin Australia Velocity",
	qantas: "Qantas Frequent Flyer",
	connectmiles: "Copa ConnectMiles",
	azul: "Azul TudoAzul",
	smiles: "GOL Smiles",
	flyingblue: "Air France/KLM Flying Blue",
	jetblue: "JetBlue TrueBlue",
	qatar: "Qatar Privilege Club",
	turkish: "Turkish Miles & Smiles",
	singapore: "Singapore KrisFlyer",
	ethiopian: "Ethiopian ShebaMiles",
	saudia: "Saudi AlFursan",
};

const CABINS = {
	Y: "Economy",
	W: "Premium Economy",
	J: "Business",
	F: "First",
};

const CABINS_BY_SOURCE: Record<string, string[]> = {
	eurobonus: ["Y", "J"],
	virginatlantic: ["Y", "W", "J"],
	aeromexico: ["Y", "W", "J"],
	american: ["Y", "W", "J", "F"],
	delta: ["Y", "W", "J"],
	etihad: ["Y", "J", "F"],
	united: ["Y", "W", "J", "F"],
	emirates: ["Y", "W", "J", "F"],
	aeroplan: ["Y", "W", "J", "F"],
	alaska: ["Y", "W", "J", "F"],
	velocity: ["Y", "W", "J", "F"],
	qantas: ["Y", "W", "J", "F"],
	connectmiles: ["Y", "J", "F"],
	azul: ["Y", "J"],
	smiles: ["Y", "W", "J", "F"],
	flyingblue: ["Y", "W", "J", "F"],
	jetblue: ["Y", "W", "J", "F"],
	qatar: ["Y", "J", "F"],
	turkish: ["Y", "J"],
	singapore: ["Y", "W", "J", "F"],
	ethiopian: ["Y", "J"],
	saudia: ["Y", "J", "F"],
};

const NO_SEAT_COUNT = new Set([
	"american",
	"emirates",
	"aeroplan",
	"qantas",
	"connectmiles",
	"azul",
	"qatar",
	"turkish",
	"singapore",
]);

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown error";
}

async function makeSeatsAeroRequest(
	endpoint: string,
	params: QueryParams,
	apiKey: string | undefined,
): Promise<SeatsAeroResponse> {
	if (!apiKey) {
		throw new Error(
			"Seats.aero access is unavailable because the API secret is not configured",
		);
	}

	const url = new URL(`${SEATS_AERO_BASE_URL}${endpoint}`);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			url.searchParams.append(key, value.toString());
		}
	}

	const response = await fetch(url.toString(), {
		method: "GET",
		headers: {
			Accept: "application/json",
			Authorization: apiKey,
		},
	});

	if (!response.ok) {
		throw new Error(
			`Seats.aero API request failed with status ${response.status}`,
		);
	}

	return (await response.json()) as SeatsAeroResponse;
}

export class MyMCP extends McpAgent<WorkerEnv> {
	server = new McpServer({
		name: "seats-aero-server",
		version: "0.2.0",
	});

	async init() {
		this.server.tool(
			"search_award_availability",
			{
				origin_airports: z.array(z.string()).describe("Origin airport codes"),
				destination_airports: z
					.array(z.string())
					.describe("Destination airport codes"),
				start_date: z
					.string()
					.optional()
					.describe("Start date in YYYY-MM-DD format"),
				end_date: z
					.string()
					.optional()
					.describe("End date in YYYY-MM-DD format"),
				cabin: z.enum(["economy", "premium", "business", "first"]).optional(),
				only_direct_flights: z.boolean().optional(),
				carriers: z.array(z.string()).optional(),
				order_by: z.enum(["default", "lowest_mileage"]).optional(),
				include_trips: z.boolean().optional(),
				take: z.number().min(10).max(1000).optional(),
			},
			async (args) => {
				try {
					const params: QueryParams = {
						origin_airport: args.origin_airports.join(","),
						destination_airport: args.destination_airports.join(","),
						start_date: args.start_date,
						end_date: args.end_date,
						cabin: args.cabin,
						only_direct_flights: args.only_direct_flights ? "true" : undefined,
						carriers: args.carriers?.join(","),
						order_by: args.order_by === "default" ? undefined : args.order_by,
						include_trips: args.include_trips ? "true" : undefined,
						take: args.take,
					};
					const data = await makeSeatsAeroRequest(
						"/search",
						params,
						this.env.SEATS_AERO_API_KEY,
					);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										summary: `Found ${data.length || 0} search results`,
										results: data || [],
										search_params: params,
										pricing_note:
											"Seats.aero reports monetary amounts in cents; divide by 100 for dollars.",
									},
									null,
									2,
								),
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{ type: "text", text: `Search failed: ${errorMessage(error)}` },
						],
						isError: true,
					};
				}
			},
		);

		this.server.tool(
			"bulk_availability",
			{
				source: z.string().describe("Mileage program code"),
				cabin: z.enum(["economy", "premium", "business", "first"]).optional(),
				start_date: z.string().optional(),
				end_date: z.string().optional(),
				origin_region: z
					.enum([
						"North America",
						"South America",
						"Africa",
						"Asia",
						"Europe",
						"Oceania",
					])
					.optional(),
				destination_region: z
					.enum([
						"North America",
						"South America",
						"Africa",
						"Asia",
						"Europe",
						"Oceania",
					])
					.optional(),
				take: z.number().min(10).max(1000).optional(),
				skip: z.number().min(0).optional(),
				cursor: z.number().optional(),
			},
			async (args) => {
				try {
					const params: QueryParams = {
						source: args.source,
						cabin: args.cabin,
						start_date: args.start_date,
						end_date: args.end_date,
						origin_region: args.origin_region,
						destination_region: args.destination_region,
						take: args.take,
						skip: args.skip,
						cursor: args.cursor,
					};
					const data = await makeSeatsAeroRequest(
						"/availability",
						params,
						this.env.SEATS_AERO_API_KEY,
					);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										source: args.source,
										summary: `Found ${data.Results?.length || 0} results`,
										results: data.Results || [],
										cursor: data.Cursor,
										total_results: data.TotalResults,
										search_params: params,
									},
									null,
									2,
								),
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Bulk availability failed: ${errorMessage(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);

		this.server.tool(
			"get_trips",
			{
				availability_id: z.string().describe("Availability record ID"),
				include_filtered: z.boolean().optional(),
			},
			async (args) => {
				try {
					const params: QueryParams = {
						include_filtered: args.include_filtered ? "true" : undefined,
					};
					const data = await makeSeatsAeroRequest(
						`/trips/${encodeURIComponent(args.availability_id)}`,
						params,
						this.env.SEATS_AERO_API_KEY,
					);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										availability_id: args.availability_id,
										summary: `Found ${data.data?.length || 0} trips`,
										trips: data.data || [],
										total_trips: data.data?.length || 0,
									},
									null,
									2,
								),
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Get trips failed: ${errorMessage(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);

		this.server.tool(
			"get_routes",
			{ source: z.string().describe("Mileage program code") },
			async (args) => {
				try {
					const data = await makeSeatsAeroRequest(
						"/routes",
						{ source: args.source },
						this.env.SEATS_AERO_API_KEY,
					);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										source: args.source,
										summary: `Found ${data.length || 0} routes`,
										routes: data || [],
										total_routes: data.length || 0,
									},
									null,
									2,
								),
							},
						],
					};
				} catch (error) {
					return {
						content: [
							{
								type: "text",
								text: `Get routes failed: ${errorMessage(error)}`,
							},
						],
						isError: true,
					};
				}
			},
		);

		this.server.tool("list_sources", {}, async () => {
			const sourceList = Object.entries(SOURCES).map(([code, name]) => ({
				code,
				name,
				cabins: CABINS_BY_SOURCE[code] || ["Y", "W", "J", "F"],
				has_seat_count: !NO_SEAT_COUNT.has(code),
				has_trip_data: true,
			}));
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								sources: sourceList,
								cabins: CABINS,
								total_sources: sourceList.length,
							},
							null,
							2,
						),
					},
				],
			};
		});

		this.server.tool(
			"generate_alaska_booking_link",
			{
				origin: z.string(),
				destination: z.string(),
				departure_date: z.string(),
				return_date: z.string().optional(),
				adults: z.number().min(1).max(9).optional(),
				departure_time: z
					.enum(["Anytime", "Morning", "Afternoon", "Evening"])
					.optional(),
				award_type: z.enum(["MilesOnly", "MilesPlusCash"]).optional(),
			},
			async (args) => {
				const params = new URLSearchParams({
					O: args.origin.toUpperCase(),
					D: args.destination.toUpperCase(),
					OD: args.departure_date,
					A: (args.adults || 1).toString(),
					OT: args.departure_time || "Anytime",
					RT: args.return_date ? "true" : "false",
					UPG: "none",
					ShoppingMethod: "onlineaward",
					awardType: args.award_type || "MilesOnly",
				});
				if (args.return_date) params.append("RD", args.return_date);
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									booking_url: `https://www.alaskaair.com/search/results?${params.toString()}`,
									trip_type: args.return_date ? "Round Trip" : "One Way",
									route: `${args.origin.toUpperCase()} → ${args.destination.toUpperCase()}`,
									departure_date: args.departure_date,
									return_date: args.return_date || null,
									passengers: args.adults || 1,
									award_type: args.award_type || "MilesOnly",
								},
								null,
								2,
							),
						},
					],
				};
			},
		);
	}
}

function jsonError(
	status: number,
	error: string,
	extraHeaders: HeadersInit = {},
): Response {
	return Response.json(
		{ error },
		{
			status,
			headers: {
				"Cache-Control": "no-store",
				...extraHeaders,
			},
		},
	);
}

async function requestRateLimitKey(
	request: Request,
	bearerToken: string | null,
): Promise<string> {
	if (bearerToken) return `token:${await tokenFingerprint(bearerToken)}`;
	return `ip:${request.headers.get("CF-Connecting-IP") || "unknown"}`;
}

export default {
	async fetch(
		request: Request,
		env: WorkerEnv,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			const ready = Boolean(env.MCP_AUTH_TOKEN && env.SEATS_AERO_API_KEY);
			return Response.json(
				{ status: ready ? "ready" : "configuration-required" },
				{ status: ready ? 200 : 503 },
			);
		}

		if (url.pathname !== "/mcp") {
			return jsonError(404, "Not found");
		}

		if (
			!isAllowedOrigin(request.headers.get("Origin"), env.MCP_ALLOWED_ORIGINS)
		) {
			return jsonError(403, "Origin is not allowed");
		}

		const bearerToken = getBearerToken(request.headers.get("Authorization"));
		const rateLimit = await env.MCP_RATE_LIMITER.limit({
			key: await requestRateLimitKey(request, bearerToken),
		});
		if (!rateLimit.success) {
			return jsonError(429, "Rate limit exceeded", { "Retry-After": "60" });
		}

		if (!env.MCP_AUTH_TOKEN) {
			return jsonError(503, "Server authentication is not configured");
		}
		if (
			!bearerToken ||
			!(await secureTokenEqual(bearerToken, env.MCP_AUTH_TOKEN))
		) {
			return jsonError(401, "Invalid bearer token", {
				"WWW-Authenticate": 'Bearer realm="rewards-flight-mcp"',
			});
		}

		return MyMCP.serve("/mcp").fetch(request, env, ctx);
	},
};
