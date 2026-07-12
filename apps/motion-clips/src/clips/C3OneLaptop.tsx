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
import { AuditLog } from "../lib/AuditLog";
import { countUp, EASE_IN_OUT, EASE_OUT, fade, riseIn } from "../lib/anim";
import { Caption } from "../lib/Caption";
import { CodeBlock } from "../lib/CodeBlock";
import { KenBurns } from "../lib/KenBurns";
import { Ledger } from "../lib/Ledger";
import "../lib/loadFonts";
import { MusicBed } from "../lib/MusicBed";
import { SceneFade } from "../lib/SceneFade";
import { fonts, light, type Theme } from "../theme";

export type C3Props = Record<string, never>;

// ---- Scene timing (30fps) ---------------------------------------------------
// Timed to public/audio/c3-vo.mp3 (28.42s). Boundaries at VO silences
// (ffmpeg silencedetect): 0 · 3.55 · 6.43 · 9.01 · 13.88 · 19.16 · 21.77 · 24.48.
// Rendered entirely on the deep-eucalypt band. Figures match the homepage
// stats exactly: 110 audited events · 1 human decision · $0.00 · ~21k lines.
export const SCENES = {
  s1: { from: 0, dur: 107 }, // "We ran a whole apartment building on this"
  s2: { from: 107, dur: 86 }, // "Arrears chased — correct to the cent"
  s3: { from: 193, dur: 77 }, // "Roof leak → triaged → dispatched"
  s4: { from: 270, dur: 146 }, // "Minutes drafted — not a word invented"
  s5: { from: 416, dur: 159 }, // "110 audited events"
  s6: { from: 575, dur: 78 }, // "1 human decision. All month."
  s7: { from: 653, dur: 81 }, // "$0.00 computed by an AI"
  s8: { from: 734, dur: 119 }, // "Free. Open source. Read every line."
} as const;
export const C3_DURATION = 853; // 28.43s @ 30fps

const theme: Theme = light;

// Band-coloured scene root (every C3 scene sits inside the eucalypt band).
const Band: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      background: theme.bandBg,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {children}
  </AbsoluteFill>
);

// ---- Scene 1: a generic AU walk-up pulls back to one glowing laptop ---------
const Scene1: React.FC = () => {
  const { dur } = SCENES.s1;
  return (
    <AbsoluteFill style={{ background: theme.bandBg }}>
      <KenBurns durationInFrames={dur} from={1.16} to={0.92} translate={[0, 24]}>
        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 46,
          }}
        >
          {/* stylised low-rise walk-up: three storeys of lit windows */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 20,
              borderRadius: 14,
              background: `color-mix(in oklch, ${theme.bandBg} 55%, black)`,
              border: `1.5px solid ${theme.bandLine}`,
            }}
          >
            {Array.from({ length: 3 }).map((_, r) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid
                key={r}
                style={{ display: "flex", gap: 10 }}
              >
                {Array.from({ length: 6 }).map((_, c) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid
                    key={c}
                    style={{
                      width: 54,
                      height: 44,
                      borderRadius: 4,
                      background:
                        (r + c) % 3 === 0
                          ? `color-mix(in oklch, ${theme.bandFig} 70%, transparent)`
                          : `color-mix(in oklch, ${theme.bandBg} 30%, black)`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* the one glowing laptop: terminal + a clean UI panel */}
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                inset: -50,
                borderRadius: 40,
                background: `radial-gradient(60% 60% at 50% 50%, color-mix(in oklch, ${theme.bandFig} 40%, transparent) 0%, transparent 70%)`,
              }}
            />
            <div
              style={{
                position: "relative",
                display: "flex",
                width: 760,
                background: `color-mix(in oklch, ${theme.bandBg} 45%, ${theme.card})`,
                border: `2px solid ${theme.bandLine}`,
                borderRadius: 18,
                overflow: "hidden",
                boxShadow: `0 50px 120px -50px black`,
              }}
            >
              <div
                style={{
                  flex: 1,
                  padding: "26px 28px",
                  fontFamily: fonts.mono,
                  fontSize: 22,
                  lineHeight: 1.7,
                  color: theme.bandFig,
                  borderRight: `1.5px solid ${theme.bandLine}`,
                }}
              >
                <div style={{ color: theme.bandMuted }}>$ goodstrata run</div>
                <div>› levies apportioned</div>
                <div>› arrears reconciled</div>
                <div>› minutes drafted</div>
                <div style={{ color: theme.bandMuted }}>› waiting for human…</div>
              </div>
              <div style={{ width: 300, padding: "26px 24px" }}>
                <div
                  style={{
                    fontFamily: fonts.sans,
                    fontWeight: 700,
                    fontSize: 26,
                    color: theme.bandInk,
                  }}
                >
                  This month
                </div>
                <div
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 20,
                    color: theme.bandMuted,
                    marginTop: 14,
                    lineHeight: 1.9,
                  }}
                >
                  110 events
                  <br />1 decision
                  <br />
                  $0.00 unallocated
                </div>
              </div>
            </div>
          </div>
        </AbsoluteFill>
      </KenBurns>
      <Caption theme={theme} onBand>
        We ran a whole apartment building on this
      </Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 2: arrears reconcile to $0.00 -----------------------------------
const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const settle = interpolate(frame, [24, 66], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  return (
    <Band>
      <div
        style={{
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        <Ledger
          theme={theme}
          band
          width={1000}
          title="arrears · reconciliation"
          rows={[
            ["Lot 4 — overdue levy", "$1,240.00"],
            ["Lot 9 — overdue levy", "$   890.00"],
            ["Notices issued & paid", "2 / 2"],
          ]}
          balanceLabel="Outstanding"
          balanceAmount="$0.00"
          settle={settle}
        />
      </div>
      <Caption theme={theme} onBand>
        Arrears chased — correct to the cent
      </Caption>
    </Band>
  );
};

// ---- Scene 3: repair flows reported → dispatched under a threshold ----------
const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const steps = ["Reported", "Triaged", "Dispatched"];
  const prog = interpolate(frame, [10, 60], [0, 2], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  return (
    <Band>
      <div
        style={{
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
          width: 1200,
          background: `color-mix(in oklch, ${theme.bandBg} 55%, ${theme.card})`,
          border: `1.5px solid ${theme.bandLine}`,
          borderRadius: 24,
          padding: "44px 52px 50px",
          boxShadow: "0 40px 84px -50px rgba(0,0,0,0.55)",
        }}
      >
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 700,
            fontSize: 46,
            color: theme.bandInk,
          }}
        >
          Roof leak · Lot 7
        </div>
        <div style={{ display: "flex", alignItems: "center", marginTop: 40 }}>
          {steps.map((s, i) => {
            const active = prog >= i - 0.15;
            return (
              <div key={s} style={{ display: "flex", alignItems: "center", flex: i < 2 ? 1 : 0 }}>
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      margin: "0 auto",
                      background: active ? theme.bandFig : "transparent",
                      border: `3px solid ${active ? theme.bandFig : theme.bandLine}`,
                    }}
                  />
                  <div
                    style={{
                      fontFamily: fonts.mono,
                      fontSize: 28,
                      marginTop: 14,
                      color: active ? theme.bandInk : theme.bandMuted,
                    }}
                  >
                    {s}
                  </div>
                </div>
                {i < 2 ? (
                  <div
                    style={{
                      flex: 1,
                      height: 4,
                      margin: "0 18px",
                      marginBottom: 42,
                      background: theme.bandLine,
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        transformOrigin: "left",
                        transform: `scaleX(${Math.max(0, Math.min(1, prog - i))})`,
                        background: theme.bandFig,
                      }}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 30,
            fontFamily: fonts.mono,
            fontSize: 28,
            color: theme.bandMuted,
            borderTop: `1.5px solid ${theme.bandLine}`,
            paddingTop: 24,
          }}
        >
          quote $420 ≤ $1,000 auto-dispatch threshold ✓ (code-enforced)
        </div>
      </div>
      <Caption theme={theme} onBand>
        Roof leak → triaged → dispatched
      </Caption>
    </Band>
  );
};

// ---- Scene 4: AGM minutes typewriter reveal --------------------------------
const Scene4: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const reveal = interpolate(frame, [8, 120], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  return (
    <Band>
      <div
        style={{
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        <CodeBlock
          theme={theme}
          band
          title="agm-minutes.md"
          reveal={reveal}
          fontSize={30}
          width={1240}
          lines={[
            "# Annual General Meeting — minutes",
            "",
            "Present: 9 of 12 lots (quorum met).",
            "1. Budget for 2026 adopted as tabled.",
            "2. Roof repair (Lot 7) ratified, $420.",
            "3. Insurance renewal approved.",
            "Motions carried on recorded votes.",
          ]}
        />
      </div>
      <Caption theme={theme} onBand>
        Minutes drafted — not a word invented
      </Caption>
    </Band>
  );
};

// ---- Scene 5: 110 audited events count up on the log -----------------------
const Scene5: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const value = Math.round(countUp(frame, 110, 12, 96));
  const logVisible = Math.min(12, 2 + Math.floor(frame / 10));
  const scroll = -Math.max(0, (logVisible - 8) * 72);
  return (
    <Band>
      {/* dim append-only log behind the big number */}
      <div style={{ position: "absolute", opacity: 0.32 }}>
        <AuditLog theme={theme} band visible={logVisible} scroll={scroll} width={1320} />
      </div>
      <div
        style={{
          position: "relative",
          textAlign: "center",
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            fontSize: 400,
            lineHeight: 1,
            letterSpacing: "-0.04em",
            color: theme.bandFig,
            textShadow: `0 30px 90px rgba(0,0,0,0.55)`,
          }}
        >
          {value}
        </div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 44,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: theme.bandMuted,
            marginTop: 8,
          }}
        >
          audited events
        </div>
      </div>
      <Caption theme={theme} onBand>
        110 audited events
      </Caption>
    </Band>
  );
};

// ---- Scene 6: 1 human decision, all month ----------------------------------
const Scene6: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const tap = interpolate(frame, [26, 34, 46], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glow = interpolate(frame, [26, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  return (
    <Band>
      <div
        style={{
          textAlign: "center",
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            fontSize: 300,
            lineHeight: 1,
            color: theme.bandFig,
          }}
        >
          1
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 700,
            fontSize: 52,
            color: theme.bandInk,
            marginBottom: 40,
          }}
        >
          human decision · all month
        </div>
        <div style={{ position: "relative", display: "inline-block" }}>
          <div
            style={{
              padding: "24px 70px",
              borderRadius: 18,
              background: theme.bandFig,
              color: theme.bandBg,
              fontFamily: fonts.sans,
              fontWeight: 700,
              fontSize: 40,
              boxShadow: `0 0 ${glow * 60}px ${glow * 14}px color-mix(in oklch, ${theme.bandFig} 55%, transparent)`,
            }}
          >
            Approve
          </div>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 120,
              height: 120,
              marginLeft: -60,
              marginTop: -60,
              borderRadius: "50%",
              border: `4px solid ${theme.bandFig}`,
              opacity: tap,
              transform: `scale(${0.4 + tap * 1.2})`,
            }}
          />
        </div>
      </div>
      <Caption theme={theme} onBand>
        1 human decision. All month.
      </Caption>
    </Band>
  );
};

// ---- Scene 7: $0.00 computed by an AI, code behind it ----------------------
const Scene7: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const codeIn = fade(frame, 34, 60);
  return (
    <Band>
      <div style={{ position: "absolute", opacity: codeIn * 0.5 }}>
        <CodeBlock
          theme={theme}
          band
          fontSize={30}
          width={1180}
          lines={[
            "residual = levy_total - sum(shares.values())",
            "assert residual == Decimal('0.00')",
            "return shares  # exact, every cent",
          ]}
        />
      </div>
      <div
        style={{
          position: "relative",
          textAlign: "center",
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        <div
          style={{
            fontFamily: fonts.mono,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            fontSize: 320,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: theme.bandFig,
            textShadow: `0 30px 90px rgba(0,0,0,0.6)`,
          }}
        >
          $0.00
        </div>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 40,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: theme.bandMuted,
          }}
        >
          computed, not guessed
        </div>
      </div>
      <Caption theme={theme} onBand>
        $0.00 computed by an AI
      </Caption>
    </Band>
  );
};

// ---- Scene 8: payoff — free, open source, read every line ------------------
const Scene8: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = riseIn(frame, fps, 4);
  const b = riseIn(frame, fps, 16);
  return (
    <Band>
      <div
        style={{
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 30,
        }}
      >
        <div
          style={{
            opacity: a.opacity,
            transform: `translateY(${a.translateY}px)`,
            fontFamily: fonts.mono,
            fontSize: 40,
            color: theme.bandMuted,
            border: `1.5px solid ${theme.bandLine}`,
            borderRadius: 999,
            padding: "14px 34px",
          }}
        >
          goodstrata · ~21k lines · Apache-2.0
        </div>
        <div
          style={{
            opacity: b.opacity,
            transform: `translateY(${b.translateY}px)`,
            fontFamily: fonts.sans,
            fontWeight: 800,
            fontSize: 128,
            letterSpacing: "-0.03em",
            color: theme.bandFig,
          }}
        >
          Read every line.
        </div>
      </div>
      <Caption theme={theme} onBand>
        Free. Open source. Read every line.
      </Caption>
    </Band>
  );
};

export const C3OneLaptop: React.FC<C3Props> = () => (
  <AbsoluteFill style={{ background: theme.bandBg }}>
    <Audio src={staticFile("audio/c3-vo.mp3")} />
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
