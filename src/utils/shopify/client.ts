import https from 'node:https';

export type ShopifyClientOptions = {
	domain: string;
	token: string;
	apiVersion?: string; // default 2025-07
	maxRetries?: number; // default 5
	minDelayMs?: number; // default 250
	maxDelayMs?: number; // default 4000
};

export type GraphQLResponse<T> = { data?: T; errors?: Array<{ message: string; extensions?: unknown }>; extensions?: unknown };

export class ShopifyGraphQLClient {
	private readonly domain: string;
	private readonly token: string;
	private readonly apiVersion: string;
	private readonly maxRetries: number;
	private readonly minDelayMs: number;
	private readonly maxDelayMs: number;

	constructor(opts: ShopifyClientOptions) {
		this.domain = opts.domain;
		this.token = opts.token;
		this.apiVersion = opts.apiVersion ?? '2025-07';
		this.maxRetries = opts.maxRetries ?? 5;
		this.minDelayMs = opts.minDelayMs ?? 250;
		this.maxDelayMs = opts.maxDelayMs ?? 4000;
	}

	async request<T>(query: string, variables?: Record<string, unknown>): Promise<GraphQLResponse<T>> {
		let attempt = 0;
		 
		while (true) {
			try {
				const body = JSON.stringify({ query, variables });
				const res = await this.post(body);
				const status = res.statusCode ?? 0;
				const text = res.body;
				if (status === 429 || status >= 500) {
					throw new RetryableError(`HTTP ${status}`);
				}
				const json = JSON.parse(text) as GraphQLResponse<T>;
				const throttled = Array.isArray(json.errors) && json.errors.some((e) => (e?.extensions as { code?: string } | undefined)?.code === 'THROTTLED');
				if (throttled) {
					throw new RetryableError('GraphQL throttled');
				}
				return json;
			} catch (err) {
				if (!(err instanceof RetryableError) || attempt >= this.maxRetries) {
					throw err;
				}
				attempt += 1;
				const delay = this.backoffWithJitter(attempt);
				await new Promise((r) => setTimeout(r, delay));
			}
		}
	}

	private backoffWithJitter(attempt: number): number {
		const base = Math.min(this.maxDelayMs, this.minDelayMs * 2 ** (attempt - 1));
		const jitter = Math.random() * this.minDelayMs;
		return Math.min(this.maxDelayMs, base + jitter);
	}

	private post(body: string): Promise<{ statusCode?: number; body: string }> {
		const options: https.RequestOptions = {
			method: 'POST',
			hostname: this.domain,
			path: `/admin/api/${this.apiVersion}/graphql.json`,
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(body),
				'X-Shopify-Access-Token': this.token
			}
		};
		return new Promise((resolve, reject) => {
			const req = https.request(options, (res) => {
				const chunks: Buffer[] = [];
				res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
				res.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8');
					resolve({ statusCode: res.statusCode, body: text });
				});
			});
			req.on('error', reject);
			req.write(body);
			req.end();
		});
	}
}

class RetryableError extends Error {} 