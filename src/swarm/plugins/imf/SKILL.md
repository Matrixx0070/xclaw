# IMF Tool

Access International Monetary Fund macroeconomic data including GDP, inflation, government debt, and current account (IMF DataMapper / WEO, annual data).

## Usage

```javascript
const result = await tool.execute({
  indicator: "NGDPD",
  country: "US",
  period: "2020-2026"
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| country | string | yes | ISO3 code(s), comma-separated (USA, DEU, CHN) |
| indicator | string | no | IMF code (NGDPD, PCPIPCH) or shortcut: gdp_growth, gdp_usd, gdp_per_capita, inflation, unemployment, gov_debt, current_account |
| start_year | number | no | First year |
| end_year | number | no | Last year (default current+1; future years are IMF projections) |

## Returns

```json
{
  "indicator": "NGDPD",
  "indicator_name": "Gross Domestic Product, Current Prices",
  "country": "US",
  "unit": "Billions USD",
  "data": [
    { "year": 2020, "value": 20932.8 },
    { "year": 2021, "value": 23315.1 }
  ]
}
```

## Common Indicators

| Code | Meaning |
|------|---------|
| NGDPD | GDP, current prices |
| NGDPDPC | GDP per capita |
| PCPIP | Inflation rate |
| LUR | Unemployment rate |
| BCA | Current account balance |

## Notes

- IMF DataMapper API: https://www.imf.org/external/datamapper/api
- Free, no API key required
- Data may lag by 6-12 months
