import { FilterXSS, escapeAttrValue, friendlyAttrValue, type IWhiteList } from 'xss';

/**
 * Allowlist sanitizer for author-supplied HTML (post bodies rendered from
 * markdown, the About page, embeds, emails). Anything not listed is escaped;
 * event handlers, inline styles, scripts, iframes and javascript: URLs never
 * survive. Runs in Workers and in the browser (editor preview).
 */

const allow: IWhiteList = {
	a: ['href', 'title', 'target', 'rel'],
	abbr: ['title'],
	b: [],
	blockquote: ['cite'],
	br: [],
	caption: [],
	code: ['class'],
	del: [],
	details: [],
	div: [],
	em: [],
	figcaption: [],
	figure: [],
	h1: ['id'],
	h2: ['id'],
	h3: ['id'],
	h4: ['id'],
	h5: ['id'],
	h6: ['id'],
	hr: [],
	i: [],
	img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
	input: ['type', 'checked', 'disabled'],
	kbd: [],
	li: [],
	mark: [],
	ol: ['start'],
	p: [],
	pre: [],
	s: [],
	small: [],
	source: ['src', 'type'],
	span: [],
	strong: [],
	sub: [],
	summary: [],
	sup: [],
	table: [],
	tbody: [],
	td: ['align', 'colspan', 'rowspan'],
	tfoot: [],
	th: ['align', 'colspan', 'rowspan', 'scope'],
	thead: [],
	tr: [],
	u: [],
	ul: [],
	video: ['src', 'controls', 'width', 'height', 'poster', 'preload', 'playsinline', 'muted', 'loop'],
};

const SAFE_URL = /^(https?:|mailto:|tel:|\/(?!\/)|#|\.{0,2}\/|[^:/?#]+(?:[/?#]|$))/i;
const URL_ATTRS = new Set(['href', 'src', 'poster', 'cite']);

const filter = new FilterXSS({
	whiteList: allow,
	stripIgnoreTag: true,
	stripIgnoreTagBody: ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template'],
	allowCommentTag: false,
	onTagAttr(tag, name, value) {
		// GFM task-list checkboxes only.
		if (tag === 'input' && name === 'type') return value === 'checkbox' ? 'type="checkbox"' : '';
		if (tag === 'code' && name === 'class') {
			return /^language-[\w-]+$/.test(value) ? `class="${value}"` : '';
		}
		if (URL_ATTRS.has(name)) {
			// Decode entities and strip whitespace/control chars before judging the
			// scheme, so `java&#x73;cript:` or `java\tscript:` can't slip through.
			const decoded = friendlyAttrValue(value).replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
			return SAFE_URL.test(decoded) ? `${name}="${escapeAttrValue(friendlyAttrValue(value).trim())}"` : '';
		}
		return undefined; // default handling for the remaining allowlisted attributes
	},
	onIgnoreTagAttr() {
		return ''; // drop anything not allowlisted (style, on*, data-*, …)
	},
});

/** External links open safely in a new context without leaking the opener. */
const hardenLinks = (html: string): string =>
	html.replace(/<a\s([^>]*?)target="_blank"([^>]*)>/gi, (m, pre: string, post: string) =>
		/rel="/i.test(m) ? m : `<a ${pre}target="_blank" rel="noopener noreferrer"${post}>`,
	);

export const sanitizeHtml = (html: string): string => hardenLinks(filter.process(html ?? ''));
