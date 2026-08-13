import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderMarkdown,
  highlightCode,
  escapeHtml,
} from "../ui/webchat/markdown.mjs";

describe("webchat markdown renderer", () => {
  describe("XSS safety (escape-first)", () => {
    it("script tags never survive", () => {
      const html = renderMarkdown('<script>alert(1)</script>\n\n**bold** <img src=x onerror=alert(1)>');
      assert.equal(html.includes("<script"), false);
      assert.equal(html.includes("<img"), false);
      assert.ok(html.includes("&lt;script&gt;"));
      assert.ok(html.includes("<strong>bold</strong>"));
    });

    it("code blocks escape their content", () => {
      const html = renderMarkdown('```html\n<script>alert(1)</script>\n```');
      assert.equal(html.includes("<script"), false);
      assert.ok(html.includes("&lt;script&gt;"));
    });

    it("javascript: links are not linkified", () => {
      const html = renderMarkdown("[x](javascript:alert(1)) and [ok](https://example.com)");
      assert.equal(html.includes('href="javascript:'), false);
      assert.ok(html.includes('href="https://example.com"'));
      assert.ok(html.includes('rel="noopener noreferrer"'));
    });

    it("protocol-relative links are not linkified", () => {
      const html = renderMarkdown("[x](//evil.example/x)");
      assert.equal(html.includes("<a "), false);
    });
  });

  describe("blocks", () => {
    it("headings, hr, blockquote", () => {
      const html = renderMarkdown("# Title\n\n---\n\n> quoted **bold**");
      assert.ok(html.includes("<h2>Title</h2>"));
      assert.ok(html.includes("<hr>"));
      assert.ok(html.includes("<blockquote>"));
      assert.ok(html.includes("<strong>bold</strong>"));
    });

    it("fenced code with language + copy affordance", () => {
      const html = renderMarkdown('```js\nconst x = "hi"; // note\n```');
      assert.ok(html.includes('class="codeblock"'));
      assert.ok(html.includes('<span class="lang">js</span>'));
      assert.ok(html.includes("copy-code"));
      assert.ok(html.includes('tok-kw">const'));
      assert.ok(html.includes('tok-str">&quot;hi&quot;'));
      assert.ok(html.includes('tok-com">// note'));
    });

    it("unordered + ordered lists with one nesting level", () => {
      const html = renderMarkdown("- a\n- b\n  - b1\n- c\n\n1. one\n2. two");
      assert.ok(html.includes("<ul><li>a</li><li>b<ul><li>b1</li></ul></li><li>c</li></ul>"));
      assert.ok(html.includes("<ol><li>one</li><li>two</li></ol>"));
    });

    it("tables", () => {
      const html = renderMarkdown("| A | B |\n|---|---|\n| 1 | `x` |");
      assert.ok(html.includes("<table>"));
      assert.ok(html.includes("<th>A</th>"));
      assert.ok(html.includes('<td><code class="ic">x</code></td>'));
    });

    it("paragraphs merge lines with <br>", () => {
      const html = renderMarkdown("line one\nline two\n\nsecond para");
      assert.ok(html.includes("<p>line one<br>line two</p>"));
      assert.ok(html.includes("<p>second para</p>"));
    });
  });

  describe("inline", () => {
    it("bold / italic / strike / inline code", () => {
      const html = renderMarkdown("**b** *i* ~~s~~ `c<b>`");
      assert.ok(html.includes("<strong>b</strong>"));
      assert.ok(html.includes("<em>i</em>"));
      assert.ok(html.includes("<del>s</del>"));
      assert.ok(html.includes('<code class="ic">c&lt;b&gt;</code>'));
    });

    it("inline code content is opaque to other transforms", () => {
      const html = renderMarkdown("`**not bold**`");
      assert.equal(html.includes("<strong>"), false);
      assert.ok(html.includes("**not bold**"));
    });
  });

  describe("highlighter", () => {
    it("python comments + keywords", () => {
      const html = highlightCode('def f():\n    # comment\n    return None', "python");
      assert.ok(html.includes('tok-kw">def'));
      assert.ok(html.includes('tok-com"># comment'));
      assert.ok(html.includes('tok-kw">None'));
    });

    it("bash", () => {
      const html = highlightCode('echo "hi" # done', "bash");
      assert.ok(html.includes('tok-kw">echo'));
      assert.ok(html.includes('tok-str">&quot;hi&quot;'));
      assert.ok(html.includes('tok-com"># done'));
    });

    it("unknown language still escapes", () => {
      const html = highlightCode("<script>", "brainfuck");
      assert.equal(html.includes("<script"), false);
    });

    it("numbers", () => {
      const html = highlightCode("x = 42", "js");
      assert.ok(html.includes('tok-num">42'));
    });
  });

  it("escapeHtml covers the critical five", () => {
    assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
  });
});
