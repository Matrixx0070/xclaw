/**
 * Unit tests for capture-probe (no live audio required).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  looksLikeMonitorSource,
  parseArecordList,
  parseWpctlStatus,
  parseWpctlInspect,
  parsePactlInfo,
  parsePactlDefaultSource,
  parsePactlSourcesShort,
  captureReadyForWake,
} from "../src/voice/capture-probe.mjs";

describe("looksLikeMonitorSource", () => {
  it("detects .monitor suffix", () => {
    assert.equal(
      looksLikeMonitorSource("alsa_output.pci-0000_00_1f.3.analog-stereo.monitor"),
      true
    );
  });
  it("detects Monitor of …", () => {
    assert.equal(looksLikeMonitorSource("", "Monitor of Built-in Audio"), true);
  });
  it("detects alsa_output used as source", () => {
    assert.equal(
      looksLikeMonitorSource("alsa_output.usb-Generic-00.analog-stereo"),
      true
    );
  });
  it("accepts real alsa_input mic", () => {
    assert.equal(
      looksLikeMonitorSource("alsa_input.usb-Mic-00.mono-fallback", "USB Mic"),
      false
    );
  });
});

describe("parseArecordList", () => {
  it("parses card/device lines", () => {
    const text = `
**** List of CAPTURE Hardware Devices ****
card 0: PCH [HDA Intel PCH], device 0: ALC257 Analog [ALC257 Analog]
card 1: Device [USB Audio Device], device 0: USB Audio [USB Audio]
`;
    const cards = parseArecordList(text);
    assert.equal(cards.length, 2);
    assert.equal(cards[0].card, 0);
    assert.equal(cards[0].alsaDevice, "plughw:0,0");
    assert.equal(cards[1].id, "Device");
  });
  it("returns empty for no cards", () => {
    assert.deepEqual(parseArecordList("no devices"), []);
  });
});

describe("parseWpctlStatus", () => {
  it("finds default source with star", () => {
    const text = `
Audio
 ├─ Devices:
 │      40. Built-in Audio
 ├─ Sinks:
 │  *   48. Speakers
 ├─ Sources:
 │  *   49. USB Microphone
 │      50. Monitor of Speakers
 └─ Filters:
`;
    const { sources, defaultSource } = parseWpctlStatus(text);
    assert.ok(sources.length >= 1);
    assert.equal(defaultSource?.name, "USB Microphone");
    assert.equal(defaultSource?.isDefault, true);
    const mon = sources.find((s) => /Monitor/i.test(s.name));
    assert.ok(mon);
    assert.equal(mon.looksLikeMonitor, true);
  });
});

describe("parseWpctlInspect", () => {
  it("extracts node.name and flags monitor", () => {
    const text = `
* node.name = "alsa_output.pci-0000.monitor"
* media.class = "Audio/Source"
* node.description = "Monitor of Built-in"
`;
    const p = parseWpctlInspect(text);
    assert.equal(p.nodeName, "alsa_output.pci-0000.monitor");
    assert.equal(p.looksLikeMonitor, true);
  });
});

describe("parsePactlInfo", () => {
  it("parses PipeWire pulse server and default source", () => {
    const text = `
Server String: /run/user/1000/pulse/native
Server Name: PulseAudio (on PipeWire 1.2.7)
Default Sink: alsa_output.pci-0000_00_1f.3.analog-stereo
Default Source: alsa_input.usb-Mic-00.mono-fallback
`;
    const p = parsePactlInfo(text);
    assert.equal(p.onPipeWire, true);
    assert.match(p.serverName, /PipeWire/);
    assert.equal(p.defaultSource, "alsa_input.usb-Mic-00.mono-fallback");
    assert.equal(p.defaultSink, "alsa_output.pci-0000_00_1f.3.analog-stereo");
  });
});

describe("parsePactlDefaultSource", () => {
  it("returns source name", () => {
    assert.equal(
      parsePactlDefaultSource("alsa_input.pci-0000_00_1f.3.analog-stereo\n"),
      "alsa_input.pci-0000_00_1f.3.analog-stereo"
    );
  });
  it("returns null on failure text", () => {
    assert.equal(parsePactlDefaultSource("Failure: No such entity"), null);
  });
});

describe("parsePactlSourcesShort", () => {
  it("parses short list and flags monitors", () => {
    const text = [
      "0\talsa_output.pci-0000_00_1f.3.analog-stereo.monitor\tmodule-alsa-card.c\ts16le 2ch 44100Hz\tIDLE",
      "1\talsa_input.pci-0000_00_1f.3.analog-stereo\tmodule-alsa-card.c\ts16le 2ch 44100Hz\tRUNNING",
    ].join("\n");
    const sources = parsePactlSourcesShort(text);
    assert.equal(sources.length, 2);
    assert.equal(sources[0].looksLikeMonitor, true);
    assert.equal(sources[1].looksLikeMonitor, false);
    assert.equal(sources[1].name, "alsa_input.pci-0000_00_1f.3.analog-stereo");
  });
});

describe("captureReadyForWake", () => {
  it("rejects monitor default", () => {
    assert.equal(
      captureReadyForWake({ ok: true, monitorRejected: true }),
      false
    );
  });
  it("accepts explicit target", () => {
    assert.equal(
      captureReadyForWake({ ok: true, explicit: true, monitorRejected: false }),
      true
    );
  });
  it("accepts ok non-monitor", () => {
    assert.equal(
      captureReadyForWake({ ok: true, monitorRejected: false }),
      true
    );
  });
  it("rejects null", () => {
    assert.equal(captureReadyForWake(null), false);
  });
});
