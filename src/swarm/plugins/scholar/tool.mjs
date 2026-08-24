/**
 * Scholar Tool — REAL academic paper search via the keyless Semantic Scholar
 * Graph API (api.semanticscholar.org). Chosen over scraping Google Scholar,
 * which has no API and blocks automated access.
 */
import { makeHttp, capList } from "../../plugins-lib/http.mjs";

const BASE = "https://api.semanticscholar.org/graph/v1";
const FIELDS = "title,year,authors,abstract,citationCount,externalIds,url,venue";

/** OpenAlex ships abstracts as {word: [positions]} — rebuild the text. */
function reconstructAbstract(inv) {
  const out = [];
  for (const [word, positions] of Object.entries(inv || {})) {
    for (const pos of positions) out[pos] = word;
  }
  return out.filter(Boolean).join(" ");
}

export class ScholarTool {
  constructor({ fetchImpl } = {}) {
    this.name = "scholar";
    this.description =
      "Search REAL academic literature (papers, citations, abstracts) via the Semantic Scholar Graph API. Returns title, authors, year, venue, citation count, DOI/arXiv ids, and abstract.";
    this._get = makeHttp(fetchImpl);
    this.parameters = {
      query: { type: "string", description: "Search query (topic, title, author keywords)", required: true },
      limit: { type: "number", description: "Max results (default 8, max 20)", default: 8 },
      year_from: { type: "number", description: "Only papers from this year onward" },
      fields_of_study: { type: "string", description: "e.g. Computer Science, Medicine, Economics" },
    };
  }

  getSchema() {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            limit: { type: "number", minimum: 1, maximum: 20, default: 8 },
            year_from: { type: "number" },
            fields_of_study: { type: "string" },
          },
          required: ["query"],
        },
      },
    };
  }

  async _searchS2(q, cap, year_from, fields_of_study) {
    let url = `${BASE}/paper/search?query=${encodeURIComponent(q)}&limit=${cap}&fields=${FIELDS}`;
    if (year_from) url += `&year=${encodeURIComponent(String(year_from))}-`;
    if (fields_of_study) url += `&fieldsOfStudy=${encodeURIComponent(String(fields_of_study))}`;
    const j = await this._get(url);
    const papers = (j?.data || []).map((p) => ({
      title: p.title,
      year: p.year,
      authors: capList((p.authors || []).map((a) => a.name), 6),
      venue: p.venue || undefined,
      citations: p.citationCount,
      doi: p.externalIds?.DOI || undefined,
      arxiv: p.externalIds?.ArXiv || undefined,
      url: p.url,
      abstract: p.abstract ? String(p.abstract).slice(0, 600) : undefined,
    }));
    return { totalMatches: j?.total ?? papers.length, papers, source: "Semantic Scholar Graph API (live)" };
  }

  async _searchOpenAlex(q, cap, year_from) {
    // Fallback backend — OpenAlex is keyless with generous limits; the S2
    // anonymous pool 429s under load.
    let url = `https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=${cap}&sort=relevance_score:desc`;
    if (year_from) url += `&filter=from_publication_date:${encodeURIComponent(String(year_from))}-01-01`;
    const j = await this._get(url);
    const papers = (j?.results || []).map((w) => ({
      title: w.title || w.display_name,
      year: w.publication_year,
      authors: capList((w.authorships || []).map((a) => a.author?.display_name).filter(Boolean), 6),
      venue: w.primary_location?.source?.display_name || undefined,
      citations: w.cited_by_count,
      doi: w.doi ? String(w.doi).replace("https://doi.org/", "") : undefined,
      url: w.primary_location?.landing_page_url || w.id,
      abstract: w.abstract_inverted_index ? reconstructAbstract(w.abstract_inverted_index).slice(0, 600) : undefined,
    }));
    return { totalMatches: j?.meta?.count ?? papers.length, papers, source: "OpenAlex API (live, Semantic Scholar fallback)" };
  }

  async execute({ query, limit = 8, year_from, fields_of_study } = {}) {
    const q = String(query || "").trim();
    if (!q) return { success: false, error: "query required" };
    const cap = Math.min(Math.max(Number(limit) || 8, 1), 20);
    try {
      const data = await this._searchS2(q, cap, year_from, fields_of_study);
      return { success: true, data: { query: q, ...data } };
    } catch (s2err) {
      try {
        const data = await this._searchOpenAlex(q, cap, year_from);
        return { success: true, data: { query: q, ...data } };
      } catch (oaErr) {
        return { success: false, error: `Semantic Scholar: ${s2err.message}; OpenAlex fallback: ${oaErr.message}` };
      }
    }
  }
}
