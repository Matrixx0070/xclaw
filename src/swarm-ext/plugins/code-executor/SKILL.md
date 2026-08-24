# Code Executor Tool

Execute code in a sandboxed environment with resource limits.

## Usage

```javascript
const result = await tool.execute({
  code: "console.log(2 + 2)",
  language: "javascript",
  timeout: 30000
});
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| code | string | yes | Code to execute |
| language | string | yes | "javascript", "python", "bash" |
| timeout | number | no | Max execution time in ms (default 30000) |
| stdin | string | no | Input to pipe to the process |

## Returns

```json
{
  "stdout": "4\n",
  "stderr": "",
  "exit_code": 0,
  "duration_ms": 150
}
```

## Security

- Runs in Docker sandbox with read-only rootfs
- Memory limit: 512MB
- CPU limit: 1.0
- Network: bridge mode (egress controlled by policy)
- No sudo, no setuid
