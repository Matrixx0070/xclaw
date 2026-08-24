# SEC EDGAR Tool

Query U.S. Securities and Exchange Commission EDGAR database for company filings, financial reports, and disclosures.

## Usage

```javascript
const result = await tool.execute({
  ticker: "AAPL",
  filing_type: "10-K",
  limit: 5
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| ticker | string | yes | Ticker symbol (AAPL) or numeric CIK |
| action | string | no | "filings" (default) or "facts" (key XBRL financials) |
| filing_type | string | no | "10-K", "10-Q", "8-K", "DEF 14A", "S-1", "all" |
| limit | number | no | Max filings (default 10, max 40) |

## Returns

```json
{
  "cik": "0000320193",
  "company_name": "Apple Inc.",
  "filings": [
    {
      "filing_type": "10-K",
      "filing_date": "2024-11-01",
      "accession_number": "0000320193-24-000123",
      "url": "https://www.sec.gov/Archives/...",
      "size": "15.2 MB"
    }
  ]
}
```

## Notes

- SEC EDGAR API: https://www.sec.gov/edgar/sec-api-documentation
- Requires User-Agent header (set in config)
- Rate limit: 10 requests/second
- CIK lookup: https://www.sec.gov/cgi-bin/browse-edgar?company=
