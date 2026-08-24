# Calculator Tool

Evaluate mathematical expressions safely without using eval().

## Usage

```javascript
const result = await tool.execute({
  expression: "2 + 2 * 3",
  precision: 2
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| expression | string | yes | Math expression |
| precision | number | no | Decimal places (default 10) |

## Returns

```json
{
  "result": 8,
  "expression": "2 + 2 * 3",
  "precision": 2
}
```

## Supported Operators

- `+`, `-`, `*`, `/`, `**` (power)
- `()`, `[]`, `{}` (grouping)
- `sqrt()`, `abs()`, `sin()`, `cos()`, `tan()`, `log()`, `ln()`, `exp()`
- `pi`, `e` (constants)

## Security

- No eval() — uses a safe math parser
- No network access
- No file system access
- Max expression length: 1000 chars
