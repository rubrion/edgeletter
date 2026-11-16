type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {
		/** Publication this request belongs to; resolved from the Host header in middleware. */
		publication: import("./lib/tenant").PublicationContext;
	}
}
