import type React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { EASE_IN_OUT, EASE_OUT, fade, riseIn } from "../lib/anim";
import { AuditLog } from "../lib/AuditLog";
import { Caption } from "../lib/Caption";
import { CodeBlock } from "../lib/CodeBlock";
import { Ledger } from "../lib/Ledger";
import "../lib/loadFonts";
import { MusicBed } from "../lib/MusicBed";
import { SceneFade } from "../lib/SceneFade";
import { fonts, light, type Theme } from "../theme";

export type C2Props = Record<string, never>;

// ---- Scene timing (30fps) ---------------------------------------------------
// Timed to public/audio/c2-vo.mp3 (29.54s). Boundaries land in the VO silences
// (ffmpeg silencedetect): 0 · 4.68 · 7.61 · 10.73 · 14.24 · 20.43 · 23.14 · 26.17.
export const SCENES = {
  s1: { from: 0, dur: 140 }, // "Trust an AI with our money?"
  s2: { from: 140, dur: 88 }, // "You shouldn't. So we didn't."
  s3: { from: 228, dur: 94 }, // "The AI only drafts and suggests"
  s4: { from: 322, dur: 105 }, // "The money is deterministic code"
  s5: { from: 427, dur: 186 }, // "…your levies still sum to the cent"
  s6: { from: 613, dur: 81 }, // "Anything that spends money stops for a human"
  s7: { from: 694, dur: 91 }, // "On a log not even we can edit"
  s8: { from: 785, dur: 101 }, // "Try it. Read the code. It's free."
} as const;
export const C2_DURATION = 886; // 29.53s @ 30fps

const theme: Theme = light;

// ---- Scene 1: a skeptical comment bubble on paper ---------------------------
const Scene1: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
          position: "relative",
          width: 1120,
          background: theme.card,
          border: `1.5px solid ${theme.line}`,
          borderRadius: 32,
          padding: "52px 60px",
          boxShadow: "0 50px 100px -60px rgba(15,20,28,0.55)",
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 26,
            color: theme.faintInk,
            marginBottom: 18,
          }}
        >
          Owner · committee thread
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 700,
            fontSize: 68,
            letterSpacing: "-0.02em",
            lineHeight: 1.14,
            color: theme.ink,
          }}
        >
          “Trust an AI with our money? Absolutely not.”
        </div>
        {/* bubble tail */}
        <div
          style={{
            position: "absolute",
            left: 90,
            bottom: -30,
            width: 60,
            height: 60,
            background: theme.card,
            borderRight: `1.5px solid ${theme.line}`,
            borderBottom: `1.5px solid ${theme.line}`,
            transform: "rotate(45deg)",
          }}
        />
      </div>
      <Caption theme={theme}>Trust an AI with our money?</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 2: "You shouldn't. So we didn't." + eucalypt underline -----------
const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = riseIn(frame, fps, 2);
  const b = riseIn(frame, fps, 18);
  const underline = interpolate(frame, [30, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 700,
          fontSize: 132,
          letterSpacing: "-0.03em",
          color: theme.mutedInk,
          opacity: a.opacity,
          transform: `translateY(${a.translateY}px)`,
        }}
      >
        You shouldn’t.
      </div>
      <div
        style={{
          position: "relative",
          opacity: b.opacity,
          transform: `translateY(${b.translateY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 800,
            fontSize: 148,
            letterSpacing: "-0.03em",
            color: theme.ink,
          }}
        >
          So we didn’t.
        </div>
        <div
          style={{
            position: "absolute",
            left: 0,
            bottom: 6,
            height: 12,
            width: `${underline * 100}%`,
            borderRadius: 6,
            background: theme.primary,
          }}
        />
      </div>
      <Caption theme={theme}>You shouldn’t. So we didn’t.</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 3: the AI only proposes (greyed draft card, no money icon) -------
const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
          width: 1120,
          background: `color-mix(in oklch, ${theme.card} 74%, ${theme.paper})`,
          border: `1.5px dashed ${theme.line}`,
          borderRadius: 26,
          padding: "48px 56px 54px",
          overflow: "hidden",
          boxShadow: "0 40px 84px -50px rgba(15,20,28,0.4)",
        }}
      >
        {/* faint DRAFT watermark */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fonts.sans,
            fontWeight: 800,
            fontSize: 260,
            letterSpacing: "0.04em",
            color: theme.faintInk,
            opacity: 0.09,
            transform: "rotate(-12deg)",
            pointerEvents: "none",
          }}
        >
          DRAFT
        </div>
        <div
          style={{
            display: "inline-block",
            fontFamily: fonts.mono,
            fontSize: 24,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: theme.faintInk,
            border: `1.5px solid ${theme.line}`,
            borderRadius: 999,
            padding: "8px 20px",
          }}
        >
          AI · proposes
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 700,
            fontSize: 56,
            letterSpacing: "-0.02em",
            color: theme.mutedInk,
            marginTop: 22,
          }}
        >
          Suggested: dispatch plumber for roof leak
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 34,
            color: theme.faintInk,
            marginTop: 12,
            fontStyle: "italic",
          }}
        >
          Awaiting a human — this draft moves no money.
        </div>
      </div>
      <Caption theme={theme}>The AI only drafts and suggests</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 4: the money is deterministic code -------------------------------
const Scene4: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const reveal = interpolate(frame, [8, 78], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        <CodeBlock
          theme={theme}
          title="apportion.py"
          reveal={reveal}
          lines={[
            "def apportion(levy_total, lots):",
            "    shares = {}",
            "    for lot in lots:",
            "        shares[lot.id] = round(",
            "            levy_total * lot.entitlement, 2)",
            "    assert sum(shares.values()) == levy_total",
            "    return shares",
          ]}
        />
      </div>
      <Caption theme={theme}>The money is deterministic code</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 5: AI node dissolves while the ledger still reconciles to $0.00 --
const Scene5: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  // AI node glitches (deterministic flicker) then dissolves away.
  const flicker =
    frame < 96
      ? 0.55 + 0.45 * Math.abs(Math.sin(frame * 0.8))
      : 0;
  const aiFade = interpolate(frame, [96, 140], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  const aiOpacity = flicker * (frame < 96 ? 1 : aiFade);
  const offline = interpolate(frame, [70, 96], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Ledger reconciles regardless — settles after the AI is gone.
  const settle = interpolate(frame, [110, 160], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });

  return (
    <AbsoluteFill
      style={{
        background: theme.bandBg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 70,
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        {/* the AI node */}
        <div style={{ position: "relative", width: 320, textAlign: "center" }}>
          <div
            style={{
              width: 320,
              height: 320,
              borderRadius: 40,
              border: `2px solid ${theme.bandLine}`,
              background: `color-mix(in oklch, ${theme.bandBg} 40%, ${theme.card})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: fonts.mono,
              fontWeight: 600,
              fontSize: 96,
              color: theme.bandFig,
              opacity: aiOpacity,
              filter: `blur(${(1 - (aiOpacity || 0.001)) * 4}px)`,
            }}
          >
            AI
          </div>
          <div
            style={{
              marginTop: 20,
              fontFamily: fonts.mono,
              fontSize: 30,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: theme.critical,
              opacity: offline,
            }}
          >
            offline
          </div>
        </div>

        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 90,
            color: theme.bandMuted,
          }}
        >
          →
        </div>

        <Ledger
          theme={theme}
          band
          width={720}
          title="levy run · reconciliation"
          rows={[
            ["Lot entitlements", "12 / 12"],
            ["Apportioned", "$8,400.00"],
            ["Rounding residual", "$0.00"],
          ]}
          balanceLabel="Unallocated"
          balanceAmount="$0.00"
          settle={settle}
        />
      </div>
      <Caption theme={theme} onBand>
        Your levies still sum to the cent
      </Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 6: anything that spends money stops for a human ------------------
const Scene6: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const cursorX = interpolate(frame, [12, 40], [220, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  const cursorY = interpolate(frame, [12, 40], [150, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  const tap = interpolate(frame, [40, 48, 58], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glow = interpolate(frame, [40, 52], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
          width: 900,
          background: theme.card,
          border: `1.5px solid ${theme.line}`,
          borderRadius: 28,
          padding: "48px 54px 46px",
          boxShadow: "0 60px 130px -60px rgba(15,20,28,0.6)",
          position: "relative",
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 24,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: theme.mutedInk,
          }}
        >
          Spends money · human required
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 700,
            fontSize: 48,
            letterSpacing: "-0.02em",
            color: theme.ink,
            marginTop: 12,
          }}
        >
          Pay contractor invoice
        </div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 40,
            color: theme.ink,
            marginTop: 8,
          }}
        >
          $2,400.00
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 40 }}>
          <div
            style={{
              flex: 1,
              textAlign: "center",
              padding: "22px 0",
              borderRadius: 16,
              background: theme.primary,
              color: theme.onPrimary,
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 34,
              boxShadow: `0 0 ${glow * 52}px ${glow * 10}px color-mix(in oklch, ${theme.primary} 60%, transparent)`,
            }}
          >
            Approve
          </div>
          <div
            style={{
              padding: "22px 42px",
              borderRadius: 16,
              border: `1.5px solid ${theme.line}`,
              color: theme.ink,
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 34,
            }}
          >
            Hold
          </div>
        </div>
        {/* cursor + tap ripple over Approve */}
        <div
          style={{
            position: "absolute",
            left: 250,
            bottom: 60,
            transform: `translate(${cursorX}px, ${cursorY}px)`,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -28,
              top: -28,
              width: 92,
              height: 92,
              borderRadius: "50%",
              border: `4px solid ${theme.primary}`,
              opacity: tap,
              transform: `scale(${0.4 + tap * 1.1})`,
            }}
          />
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: theme.ink,
              opacity: 0.82,
            }}
          />
        </div>
      </div>
      <Caption theme={theme}>Anything that spends money stops for a human</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 7: append-only, hash-stamped log --------------------------------
const Scene7: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const visible = Math.min(12, 3 + Math.floor(frame / 7));
  // slide the stack up as rows append past the viewport
  const scroll = -Math.max(0, (visible - 8) * 72);
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        <AuditLog theme={theme} visible={visible} scroll={scroll} />
      </div>
      <Caption theme={theme}>On a log not even we can edit</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 8: payoff — try it, read the code, it's free --------------------
const Scene8: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = riseIn(frame, fps, 4);
  const caret = frame % 30 < 15 ? 1 : 0;
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 32,
      }}
    >
      <div
        style={{
          opacity: a.opacity,
          transform: `translateY(${a.translateY}px)`,
          fontFamily: fonts.mono,
          fontSize: 44,
          color: theme.mutedInk,
          background: theme.card,
          border: `1.5px solid ${theme.line}`,
          borderRadius: 18,
          padding: "26px 44px",
          boxShadow: "0 30px 70px -44px rgba(15,20,28,0.5)",
        }}
      >
        <span style={{ color: theme.primary }}>$</span> git clone goodstrata
        <span style={{ opacity: caret, color: theme.ink }}>▋</span>
      </div>
      <div
        style={{
          opacity: fade(frame, 16, 30),
          fontFamily: fonts.sans,
          fontWeight: 800,
          fontSize: 120,
          letterSpacing: "-0.03em",
          color: theme.ink,
        }}
      >
        Read the code.
      </div>
      <Caption theme={theme}>Try it. Read the code. It’s free.</Caption>
    </AbsoluteFill>
  );
};

export const C2TheMoneyIsCode: React.FC<C2Props> = () => (
  <AbsoluteFill style={{ background: theme.paper }}>
    <Audio src={staticFile("audio/c2-vo.mp3")} />
    <MusicBed src="audio/music-clips.mp3" />
    {(
      [
        [SCENES.s1, Scene1],
        [SCENES.s2, Scene2],
        [SCENES.s3, Scene3],
        [SCENES.s4, Scene4],
        [SCENES.s5, Scene5],
        [SCENES.s6, Scene6],
        [SCENES.s7, Scene7],
        [SCENES.s8, Scene8],
      ] as const
    ).map(([s, C], i) => (
      <Sequence
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed scene order
        key={i}
        from={s.from}
        durationInFrames={s.dur}
      >
        <SceneFade>
          <C />
        </SceneFade>
      </Sequence>
    ))}
  </AbsoluteFill>
);
