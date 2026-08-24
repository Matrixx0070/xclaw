# Yahoo Finance Tool

Fetch real-time stock quotes, historical price data, and company fundamentals from Yahoo Finance.

## Usage

```javascript
const result = await tool.execute({
  symbol: "AAPL",
  data_type: "quote",
  period: "1y"
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| symbol | string | yes | Stock ticker (e.g., AAPL, TSLA) |
| data_type | string | no | "quote", "history", "info", "dividends" |
| period | string | no | "1d", "5d", "1mo", "3mo", "6mo", "1y", "5y" |
| interval | string | no | "1m", "2m", "5m", "15m", "30m", "60m", "1d", "1wk", "1mo" |

## Returns

```json
{
  "symbol": "AAPL",
  "price": 189.50,
  "change": 1.25,
  "change_percent": 0.66,
  "currency": "USD",
  "market_cap": 2900000000000,
  "pe_ratio": 29.5,
  "timestamp": "2026-08-24T10:45:00Z"
}
```

## Notes

- Data is delayed by ~15 minutes for free tier
- Rate limit: 2000 requests/hour
- Supports international exchanges (append exchange suffix, e.g., "BABA.HK")
