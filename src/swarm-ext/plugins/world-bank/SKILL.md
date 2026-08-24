# World Bank Tool

Access World Bank Open Data API for development indicators, poverty statistics, education, health, and economic metrics.

## Usage

```javascript
const result = await tool.execute({
  indicator: "NY.GDP.MKTP.CD",
  country: "US",
  date: "2020:2026"
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| country | string | yes | ISO2/ISO3 country code (US, DEU) |
| indicator | string | no | Indicator code (NY.GDP.MKTP.CD) or shortcut: gdp, gdp_growth, gdp_per_capita, population, inflation, unemployment, life_expectancy, co2_emissions |
| start_year | number | no | First year (default end-10) |
| end_year | number | no | Last year (default current) |

## Returns

```json
{
  "indicator": "NY.GDP.MKTP.CD",
  "indicator_name": "GDP (current US$)",
  "country": "United States",
  "country_code": "US",
  "data": [
    { "date": "2020", "value": 20953200000000 }
  ]
}
```

## Common Indicators

| Code | Meaning |
|------|---------|
| NY.GDP.MKTP.CD | GDP (current US$) |
| NY.GDP.PCAP.CD | GDP per capita |
| SI.POV.DDAY | Poverty headcount ratio |
| SE.XPD.TOTL.GD.ZS | Education expenditure (% GDP) |
| SP.DYN.LE00.IN | Life expectancy at birth |

## Notes

- API: https://api.worldbank.org/v2/
- Free, no API key required
- Supports 200+ countries and 1000+ indicators
