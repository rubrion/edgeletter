import type { CapacitorConfig } from '@capacitor/cli';

// The app is app.edgeletter.blog (the Studio) in a native shell, so every web
// deploy updates the app too. Only the Studio and Cloudflare's bot check load
// inside; the landing page, public blogs and any other link open in the
// system browser. Offline, the app shows www/offline.html.
const config: CapacitorConfig = {
	appId: 'blog.edgeletter',
	appName: 'EdgeLetter',
	webDir: 'www',
	server: {
		url: 'https://app.edgeletter.blog',
		allowNavigation: ['app.edgeletter.blog', 'challenges.cloudflare.com'],
		errorPath: 'offline.html',
	},
	// The web app reads it (src/lib/native.ts) to leave out plans, checkout and
	// the Stripe portal: Google Play only allows digital purchases through
	// Play Billing. It also swaps Google sign-in for the emailed code.
	appendUserAgent: 'EdgeLetterApp',
	backgroundColor: '#E7E4DE',
	android: { allowMixedContent: false },
};

export default config;
