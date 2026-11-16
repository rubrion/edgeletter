import { test, expect } from 'bun:test';
import { sanitizeHtml as s } from '../src/lib/sanitize';
test('strips scripts/handlers/styles', () => {
  expect(s('<p onclick="x()" style="color:red">hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
  expect(s('<img src=x onerror=alert(1)>')).toBe('<img src="x">');
  expect(s('<iframe src="https://evil"></iframe>ok')).toBe('ok');
});
test('blocks bad urls', () => {
  for (const u of ['javascript:alert(1)', 'java&#x73;cript:alert(1)', ' JaVaScRiPt:x', 'java\tscript:x', 'data:text/html,x', 'vbscript:x'])
    expect(s(`<a href="${u}">x</a>`)).toBe('<a>x</a>');
});
test('keeps safe content', () => {
  expect(s('<a href="https://a.com/x?y=1&amp;z=2" title="t">x</a>')).toBe('<a href="https://a.com/x?y=1&amp;z=2" title="t">x</a>');
  expect(s('<a href="/blog/x">x</a>')).toBe('<a href="/blog/x">x</a>');
  expect(s('<a href="#sec">x</a>')).toBe('<a href="#sec">x</a>');
  expect(s('<a href="mailto:a@b.c">x</a>')).toBe('<a href="mailto:a@b.c">x</a>');
  expect(s('<pre><code class="language-ts">a &lt; b</code></pre>')).toBe('<pre><code class="language-ts">a &lt; b</code></pre>');
  expect(s('<video src="https://m/x.mp4" controls></video>')).toContain('controls');
  expect(s('<a href="https://x" target="_blank">x</a>')).toBe('<a href="https://x" target="_blank" rel="noopener noreferrer">x</a>');
  expect(s('<code class="x onmouseover=1">c</code>')).toBe('<code>c</code>');
});
