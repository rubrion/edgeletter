type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
	interface Locals extends Runtime {
		/**
		 * Publication this request acts on: from the Host on public sites, from
		 * the session's active publication on the app host. Unset on platform pages.
		 */
		publication: import("./lib/tenant").PublicationContext;
		/** Signed-in user (app host only). */
		user?: import("./db").User;
		/** The user's role in `publication` (app host only). */
		role?: import("./db").Role;
		/** Request comes from the store app (src/lib/native.ts): hide all purchases. */
		inApp: boolean;
	}
}
