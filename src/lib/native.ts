/**
 * The Android app (mobile/) is a Capacitor shell around app.edgeletter.blog
 * that appends this token to the WebView user agent. Google Play only allows
 * digital purchases through its own billing, so requests from the app never
 * see plans, checkout, the Stripe portal or links that steer to them.
 */
export const APP_UA_TOKEN = 'EdgeLetterApp';

const APP_UA_RE = new RegExp(`\\b${APP_UA_TOKEN}\\b`);

export const inStoreApp = (request: Request): boolean => APP_UA_RE.test(request.headers.get('user-agent') ?? '');
