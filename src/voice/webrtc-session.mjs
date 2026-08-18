/**
 * R1 — WebRTC signaling + optional receive-only audio (werift).
 *
 * Without `werift` installed, offer handling returns a structured error so
 * clients can fall back to /ws/voice PCM or Opus.
 */

/**
 * @returns {Promise<{ ok: boolean, engine?: string, error?: string }>}
 */
export async function probeWebRtc() {
  try {
    await import("werift");
    return { ok: true, engine: "werift" };
  } catch (e) {
    return {
      ok: false,
      error:
        e?.message ||
        "werift not installed (npm i werift) — use PCM/Opus on /ws/voice",
    };
  }
}

/**
 * Create a receive-oriented peer connection from a remote SDP offer.
 * On remote audio track, PCM frames are delivered to onPcm(chunk).
 *
 * @param {string} offerSdp
 * @param {{ sampleRate?: number, onPcm?: (buf: Buffer, meta: object) => void, onState?: (s: string) => void }} [opts]
 */
export async function acceptOffer(offerSdp, opts = {}) {
  const probe = await probeWebRtc();
  if (!probe.ok) {
    return { ok: false, error: probe.error, answerSdp: null };
  }

  const werift = await import("werift");
  const {
    RTCPeerConnection,
    MediaStreamTrack,
    RTCSessionDescription,
  } = werift;

  const pc = new RTCPeerConnection({
    iceServers: opts.iceServers || [{ urls: "stun:stun.l.google.com:19302" }],
  });

  const pendingIce = [];
  let iceFlush = null;

  pc.onicecandidate = ({ candidate }) => {
    if (candidate && iceFlush) {
      iceFlush(candidate.toJSON ? candidate.toJSON() : candidate);
    } else if (candidate) {
      pendingIce.push(candidate.toJSON ? candidate.toJSON() : candidate);
    }
  };

  pc.onconnectionstatechange = () => {
    opts.onState?.(pc.connectionState);
  };

  // Prefer receiving audio
  try {
    pc.addTransceiver("audio", { direction: "recvonly" });
  } catch {
    /* older werift */
  }

  pc.ontrack = (ev) => {
    const track = ev.track;
    opts.onState?.(`track:${track.kind}:${track.id}`);
    // werift exposes different tap APIs by version — best-effort
    if (typeof track.onReceiveRtp === "object" || track.onReceiveRtp) {
      try {
        track.onReceiveRtp.subscribe?.((rtp) => {
          if (rtp?.payload) {
            opts.onPcm?.(Buffer.from(rtp.payload), {
              kind: "rtp",
              note: "raw rtp payload — may be Opus; decode upstream",
            });
          }
        });
      } catch {
        /* */
      }
    }
  };

  // werift's RTCSessionDescription takes (sdp, type) positionally; the object
  // form throws "invalid sessionDescription". Fall back to the object form for
  // other/older builds rather than assuming one shape.
  let remote;
  try {
    remote = new RTCSessionDescription(offerSdp, "offer");
  } catch {
    remote = new RTCSessionDescription({ type: "offer", sdp: offerSdp });
  }
  await pc.setRemoteDescription(remote);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  return {
    ok: true,
    engine: "werift",
    answerSdp: pc.localDescription?.sdp || answer.sdp,
    pc,
    drainIce(fn) {
      iceFlush = fn;
      for (const c of pendingIce) fn(c);
      pendingIce.length = 0;
    },
    async addIce(candidate) {
      try {
        await pc.addIceCandidate(candidate);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message || String(e) };
      }
    },
    async close() {
      try {
        pc.close();
      } catch {
        /* */
      }
    },
  };
}

export default { probeWebRtc, acceptOffer };
