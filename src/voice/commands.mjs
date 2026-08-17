/**
 * Voice command catalog — shared by TUI, WebChat, Telegram, and live agent.
 * Commands mute/cancel speech or jobs without expanding into full goals.
 */

/** @typedef {{ kind: string, label: string, patterns: RegExp[], reply?: string, slash?: string[] }} VoiceCommand */

/** @type {VoiceCommand[]} */
export const VOICE_COMMANDS = [
  {
    kind: "stop_talking",
    label: "Stop speaking",
    slash: ["/mute", "/quiet"],
    patterns: [
      /\b(stop talking|shut up|be quiet|silence|mute yourself|zip it)\b/i,
    ],
    reply: "Muted.",
  },
  {
    kind: "allow_talking",
    label: "Resume speaking",
    slash: ["/unmute", "/talk"],
    patterns: [
      /\b(you can talk|unmute|speak again|talk to me|resume speaking)\b/i,
    ],
    reply: "Speech on.",
  },
  {
    kind: "cancel_job",
    label: "Cancel active work",
    slash: ["/cancel", "/abort"],
    patterns: [
      /\b(cancel( that| it| the)?( task| job| swarm| research)?|stop (the )?(task|job|swarm|agent|work)|abort|never ?mind)\b/i,
    ],
    reply: "Cancelling.",
  },
  {
    kind: "keep_going",
    label: "Continue current work",
    slash: ["/continue"],
    patterns: [/\b(keep going|continue|don't stop|carry on|proceed)\b/i],
    reply: "Continuing.",
  },
  {
    kind: "status",
    label: "Status check",
    slash: ["/status", "/voice-status"],
    patterns: [
      /\b(what('s| is) (your )?status|are you (there|busy|working)|how are you|status report)\b/i,
    ],
    reply: null, // filled by runtime
  },
  {
    kind: "help",
    label: "Voice help",
    slash: ["/voice-help", "/commands"],
    patterns: [
      /\b(what can you (do|understand)|voice (commands|help)|help commands)\b/i,
    ],
    reply: null,
  },
  {
    kind: "repeat",
    label: "Repeat last reply",
    slash: ["/repeat"],
    patterns: [/\b(repeat( that)?|say (that|it) again|what did you say)\b/i],
    reply: null,
  },
  {
    kind: "barge_in",
    label: "Interrupt speech only",
    slash: ["/stop"],
    patterns: [/\b(hold on|wait|pause( speaking)?)\b/i],
    reply: "Paused speech.",
  },
];

/**
 * Classify user text or slash command into a voice intent.
 * @returns {{ kind: string, matched?: string, command?: VoiceCommand }}
 */
export function classifyVoiceIntent(text) {
  const raw = String(text || "").trim();
  if (!raw) return { kind: "none" };
  const t = raw.toLowerCase();

  // Slash commands first
  for (const cmd of VOICE_COMMANDS) {
    for (const s of cmd.slash || []) {
      if (t === s || t.startsWith(s + " ")) {
        return { kind: cmd.kind, matched: s, command: cmd };
      }
    }
  }

  for (const cmd of VOICE_COMMANDS) {
    for (const re of cmd.patterns) {
      if (re.test(t)) {
        return { kind: cmd.kind, matched: re.source, command: cmd };
      }
    }
  }

  return { kind: "utterance" };
}

/** Human-readable help for TUI / Telegram / WebChat */
export function voiceCommandsHelp() {
  return VOICE_COMMANDS.map(
    (c) =>
      `• ${c.label}: ${(c.slash || []).join(" ")} — e.g. “${c.patterns[0].source.slice(0, 40)}…”`
  ).join("\n");
}

export default {
  VOICE_COMMANDS,
  classifyVoiceIntent,
  voiceCommandsHelp,
};
