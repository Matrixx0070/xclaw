# LibreOffice headless automation

XClaw tool: `office_convert` (`src/tools/media-tools.mjs`).

## Recommended robust pattern (CLI batch)

```bash
PROFILE_DIR=/tmp/xclaw-lo-$(id -u)-$$
mkdir -p "$PROFILE_DIR" "$OUTDIR"
soffice --headless --nologo --nofirststartwizard --norestore \
  -env:UserInstallation="file://${PROFILE_DIR}" \
  --convert-to pdf:writer_pdf_Export \
  --outdir "$OUTDIR" \
  "$INPUT"
# verify: test -s "$OUTDIR/$(basename "${INPUT%.*}.pdf")"
rm -rf "$PROFILE_DIR"
```

### Why these flags

| Flag | Purpose |
|------|---------|
| `--headless` | No GUI |
| `--norestore` | Skip crash recovery dialogs |
| `-env:UserInstallation=file://…` | Isolated profile (avoids lock races) |
| `--convert-to EXT[:Filter]` | Output type + optional filter name |
| `--outdir` | Deterministic output directory |

### Filter mapping (extension → filter)

| Input family | `--convert-to` |
|--------------|----------------|
| Writer (doc/docx/odt/txt/rtf) → PDF | `pdf:writer_pdf_Export` |
| Calc (xls/xlsx/ods/csv) → PDF | `pdf:calc_pdf_Export` |
| Impress (ppt/pptx/odp) → PDF | `pdf:impress_pdf_Export` |
| → plain text | `txt:Text (encoded):UTF8` |
| → HTML | `html:XHTML Writer File:UTF8` |

Parallel jobs **must** use different `UserInstallation` paths (or run serially).

---

## UNO long-running pattern (high volume)

Cold-start `soffice --convert-to` pays full init/teardown per process. For many files, keep **one headless listener** and send jobs via the UNO bridge (`--accept`).

### 1. Start a dedicated listener

```bash
PROFILE_DIR=/tmp/xclaw-lo-daemon
mkdir -p "$PROFILE_DIR"
# Pick a free port; bind localhost only
PORT=2002
soffice --headless --nologo --nofirststartwizard --norestore \
  -env:UserInstallation="file://${PROFILE_DIR}" \
  --accept="socket,host=127.0.0.1,port=${PORT},tcpNoDelay=1;urp;StarOffice.ComponentContext" \
  &
echo $! > /tmp/xclaw-lo-daemon.pid
# Wait until the port accepts connections before sending work
```

`--accept` syntax (common form):

```text
socket,host=127.0.0.1,port=PORT,tcpNoDelay=1;urp;StarOffice.ComponentContext
```

- **socket** — TCP transport (pipe is an alternative on the same machine)
- **urp** — UNO remote protocol
- **StarOffice.ComponentContext** — bootstrap context name expected by clients

### 2. Send convert jobs to the listener

Subsequent CLI converts with the **same** `UserInstallation` attach to the running instance instead of starting a second full office:

```bash
soffice --headless --norestore \
  -env:UserInstallation="file://${PROFILE_DIR}" \
  --accept="socket,host=127.0.0.1,port=${PORT},tcpNoDelay=1;urp;StarOffice.ComponentContext" \
  --convert-to pdf:writer_pdf_Export \
  --outdir "$OUTDIR" \
  file1.docx file2.docx file3.docx
```

Batch many paths on one command line so init stays amortized.

### 3. Parallelism with UNO

| Strategy | How |
|----------|-----|
| **Single daemon** | One profile + one port; serialize or queue converts (simplest, safe) |
| **N daemons** | N profiles + N ports; shard files across workers (true parallel) |
| **Avoid** | Shared default profile + parallel `--convert-to` (races → empty PDFs) |

### 4. Programmatic UNO (optional)

Languages with LibreOffice UNO bindings (Python `uno`, Java) can:

1. Connect: `resolver.resolve("uno:socket,host=127.0.0.1,port=2002;urp;StarOffice.ComponentContext")`
2. Load document via `Desktop.loadComponentFromURL(...)`
3. Export with `storeToURL` + filter `PropertyValue`s (e.g. `writer_pdf_Export`)

Useful for custom export options (PDF/A, image DPI) that CLI flags do not expose cleanly.

### 5. Shutdown

```bash
kill "$(cat /tmp/xclaw-lo-daemon.pid)" 2>/dev/null || true
rm -rf /tmp/xclaw-lo-daemon
```

Or send a controlled quit through UNO desktop `terminate()`.

### 6. When to use which

| Workload | Pattern |
|----------|---------|
| Occasional agent converts (1–few files) | CLI batch + **unique temp profile** |
| Bulk pipelines / eval suites | **UNO listener** + batched `--convert-to` |
| Parallel workers | One listener **per** profile/port |

### 7. Ops checklist

- [ ] Localhost-only `--accept` bind
- [ ] Unique `UserInstallation` per daemon
- [ ] Health check: TCP connect to port before enqueue
- [ ] Verify output size `> 0` after each job
- [ ] Clean profiles on shutdown (disk growth)
- [ ] No interactive GUI instance using the same profile

---

## XClaw integration notes

- Tool name: `office_convert`
- Default path: one-shot CLI with isolated profile (see implementation)
- Future: optional `cfg.office.unoUrl` to prefer a pre-started listener for high-throughput jobs
