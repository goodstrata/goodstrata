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
import { AgmCard } from "../lib/AgmCard";
import { countUp, EASE_IN_OUT, EASE_OUT, fade, riseIn, sceneFade } from "../lib/anim";
import { Caption } from "../lib/Caption";
import { FeeCard } from "../lib/FeeCard";
import { KenBurns } from "../lib/KenBurns";
import "../lib/loadFonts";
import { fees, fonts, light, money, type Theme } from "../theme";

export type C1Props = {
  hook: "A" | "B" | "C";
};

// ---- Scene timing (30fps) ---------------------------------------------------
// Re-timed to the ElevenLabs en-AU VO (public/audio/c1-vo.mp3, ~36.9s). Scene
// boundaries land in the silences between the plan's C1 lines (measured with
// ffmpeg silencedetect) so each caption + visual lands as its line is spoken.
//   s1  0.00s  "Somewhere in your AGM papers…really costs you."
//   s2  4.40s  "The base fee is the number they show you."
//   s3  8.13s  "The extras — meeting fees, arrears notices, admin time…"
//   s4 17.20s  "Plus a commission on your building's insurance…never shown."
//   s5 21.57s  "So take a photo of the page, and drop it in."
//   s6 24.50s  "In seconds, the real number, in plain dollars."   ← $8,400 band
//   s7 28.60s  "GoodStrata does that same admin…free for your OC." ← $8,400→$0
//   s8 32.60s  "Agents do the work; you just decide." + "See your number…"
export const SCENES = {
  s1: { from: 0, dur: 132 },
  s2: { from: 132, dur: 112 },
  s3: { from: 244, dur: 272 },
  s4: { from: 516, dur: 131 },
  s5: { from: 647, dur: 88 },
  s6: { from: 735, dur: 123 },
  s7: { from: 858, dur: 120 },
  s8: { from: 978, dur: 132 },
} as const;
export const C1_DURATION = 1110; // 37.0s @ 30fps — covers the full VO + a hold.

const theme: Theme = light;

// Per-scene fade wrapper — eases each scene in over the paper root so the hard
// Sequence cuts read as gentle dissolves (premium transitions, not cuts).
const SceneFade: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneFade(frame, durationInFrames);
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

// A shared row used on the clean-UI scenes (scaled ~2x).
const MonoLine: React.FC<{
  label: string;
  amount: string;
  theme: Theme;
  strong?: boolean;
  width?: number;
}> = ({ label, amount, theme, strong, width = 1120 }) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 44,
      width,
      padding: "34px 50px",
      background: theme.card,
      border: `1.5px solid ${theme.line}`,
      borderRadius: 22,
      boxShadow: "0 34px 66px -40px rgba(15,20,28,0.5)",
    }}
  >
    <span
      style={{
        fontFamily: fonts.sans,
        fontWeight: 600,
        fontSize: 46,
        color: theme.ink,
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontFamily: fonts.mono,
        fontVariantNumeric: "tabular-nums",
        fontWeight: 600,
        fontSize: strong ? 62 : 54,
        color: theme.ink,
      }}
    >
      {amount}
    </span>
  </div>
);

// ---- Scene 1: AGM papers on a table (brand treatment) -----------------------
const Scene1: React.FC = () => {
  const { dur } = SCENES.s1;
  return (
    <AbsoluteFill style={{ background: theme.paper }}>
      {/* soft paper vignette */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(120% 90% at 50% 40%, ${theme.card} 0%, ${theme.paper} 55%, color-mix(in oklch, ${theme.ink} 8%, ${theme.paper}) 100%)`,
        }}
      />
      <KenBurns durationInFrames={dur} from={1.02} to={1.12} translate={[0, -18]}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <AgmCard theme={theme} />
        </AbsoluteFill>
      </KenBurns>
      <Caption theme={theme}>
        What does your strata manager actually cost you?
      </Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 2: base fee line rises in ----------------------------------------
const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { opacity, translateY } = riseIn(frame, fps, 4);
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ opacity, transform: `translateY(${translateY}px)` }}>
        <MonoLine
          theme={theme}
          label="Base management fee"
          amount={money(fees.base)}
          strong
          width={1180}
        />
      </div>
      <Caption theme={theme}>The base fee is the number they show you</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 3: fee cards drop and stack like bricks --------------------------
// Drops timed to the VO enumeration ("meeting fees" ~ local 36, then
// "arrears notices, admin time" ~ local 150). Sums to the extras exactly.
const Scene3: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        <MonoLine
          theme={theme}
          label="Base management fee"
          amount={money(fees.base)}
        />
        <FeeCard
          theme={theme}
          label="+ Meeting & AGM fees"
          amount={money(fees.meetings)}
          dropAt={36}
        />
        <FeeCard
          theme={theme}
          label="+ Arrears notices & admin time"
          amount={money(fees.disbursements)}
          dropAt={150}
        />
      </div>
      <Caption theme={theme}>
        + meeting fees + arrears notices + &lsquo;admin time&rsquo;
      </Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 4: insurance commission lifts out of shadow (critical) -----------
const Scene4: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { opacity, translateY } = riseIn(frame, fps, 8, 22);
  const shadow = interpolate(frame, [8, 36], [0.25, 1], {
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
      <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
        <div style={{ opacity: 0.4 }}>
          <MonoLine
            theme={theme}
            label="Base + extras"
            amount={money(fees.base + fees.disbursements + fees.meetings)}
          />
        </div>
        <div
          style={{
            opacity,
            filter: `brightness(${shadow})`,
            transform: `translateY(${translateY}px)`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 44,
              width: 1120,
              padding: "34px 50px",
              background: `color-mix(in oklch, ${theme.card} 78%, ${theme.paper})`,
              border: `1.5px solid color-mix(in oklch, ${theme.critical} 40%, ${theme.line})`,
              borderRadius: 22,
            }}
          >
            <span
              style={{
                fontFamily: fonts.sans,
                fontWeight: 500,
                fontSize: 46,
                color: theme.faintInk,
              }}
            >
              Insurance commission
            </span>
            <span
              style={{
                fontFamily: fonts.mono,
                fontWeight: 500,
                fontSize: 50,
                fontStyle: "italic",
                color: theme.critical,
              }}
            >
              undisclosed
            </span>
          </div>
        </div>
      </div>
      <Caption theme={theme}>
        + insurance commission you were never shown
      </Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 5: take a photo of the page + upload spinner ---------------------
const Scene5: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // shutter flash around frame 14
  const flash = interpolate(frame, [12, 16, 22], [0, 0.75, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const spin = (frame / fps) * 360; // spinner rotation
  const uiEnter = riseIn(frame, fps, 26);
  const phoneExit = fade(frame, 26, 38, 1, 0);

  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* phone frame snapping the page */}
      <div style={{ position: "absolute", opacity: phoneExit }}>
        <div
          style={{
            width: 460,
            height: 900,
            borderRadius: 62,
            border: `14px solid ${theme.ink}`,
            background: theme.card,
            boxShadow: "0 60px 130px -60px rgba(15,20,28,0.7)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ transform: "scale(0.38)" }}>
            <AgmCard theme={theme} />
          </div>
        </div>
      </div>

      {/* upload spinner card */}
      <div
        style={{
          opacity: uiEnter.opacity,
          transform: `translateY(${uiEnter.translateY}px)`,
          width: 860,
          padding: "52px 60px",
          background: theme.card,
          border: `1.5px solid ${theme.line}`,
          borderRadius: 26,
          boxShadow: "0 40px 84px -50px rgba(15,20,28,0.5)",
          display: "flex",
          alignItems: "center",
          gap: 36,
        }}
      >
        <div
          style={{
            width: 78,
            height: 78,
            borderRadius: "50%",
            border: `7px solid ${theme.line}`,
            borderTopColor: theme.primary,
            transform: `rotate(${spin}deg)`,
          }}
        />
        <div>
          <div
            style={{
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 40,
              color: theme.ink,
            }}
          >
            Reading your AGM pack…
          </div>
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 26,
              color: theme.faintInk,
              marginTop: 8,
            }}
          >
            agm-2026.pdf
          </div>
        </div>
      </div>

      {/* shutter flash */}
      <AbsoluteFill
        style={{ background: "white", opacity: flash, pointerEvents: "none" }}
      />
      <Caption theme={theme}>Just take a photo of the page</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 6: the real total counts up on the deep-eucalypt band ------------
const Scene6: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const value = countUp(frame, fees.total, 10, 42);
  const enter = riseIn(frame, fps, 4);
  const breakdownOpacity = fade(frame, 58, 76);

  return (
    <AbsoluteFill
      style={{
        background: theme.bandBg,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: 40,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: theme.bandMuted,
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        The real number
      </div>
      <div
        style={{
          fontFamily: fonts.mono,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          fontSize: 320,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: theme.bandFig,
          marginTop: 20,
        }}
      >
        {money(value)}
        <span style={{ fontSize: 108, color: theme.bandMuted }}> /yr</span>
      </div>
      <div
        style={{
          marginTop: 40,
          fontFamily: fonts.mono,
          fontSize: 44,
          color: theme.bandMuted,
          opacity: breakdownOpacity,
        }}
      >
        {fees.lots} lots × $700 = {money(fees.total)}
      </div>
      <Caption theme={theme} onBand>
        {money(fees.total)} / year
      </Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 7: struck $8,400 vs a clean $0 -----------------------------------
// The $0 reveal is delayed to land on the spoken word "free" (~31s).
const Scene7: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const left = riseIn(frame, fps, 4);
  const right = riseIn(frame, fps, 56);
  // line-through draws across the $8,400 (ease-in-out)
  const strike = interpolate(frame, [32, 56], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });

  const bigStyle: React.CSSProperties = {
    fontFamily: fonts.mono,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    fontSize: 210,
    lineHeight: 1,
    letterSpacing: "-0.02em",
  };

  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 72 }}>
        {/* struck 8,400 */}
        <div
          style={{
            opacity: left.opacity,
            transform: `translateY(${left.translateY}px)`,
            textAlign: "center",
            position: "relative",
          }}
        >
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 34,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: theme.mutedInk,
              marginBottom: 20,
            }}
          >
            A strata manager charges
          </div>
          <div style={{ ...bigStyle, color: theme.ink, position: "relative" }}>
            {money(fees.total)}
            <span style={{ fontSize: 76, color: theme.mutedInk }}> /yr</span>
            {/* the line-through, drawn like .receipt-big.struck */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: "52%",
                height: 8,
                width: `${strike * 100}%`,
                background: `color-mix(in oklch, ${theme.critical} 72%, transparent)`,
                borderRadius: 4,
              }}
            />
          </div>
        </div>

        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 96,
            color: theme.faintInk,
            opacity: right.opacity,
          }}
        >
          →
        </div>

        {/* clean $0 */}
        <div
          style={{
            opacity: right.opacity,
            transform: `translateY(${right.translateY}px)`,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 34,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: theme.accentInk,
              marginBottom: 20,
            }}
          >
            With GoodStrata
          </div>
          <div style={{ ...bigStyle, color: theme.primary }}>
            $0
            <span style={{ fontSize: 76, color: theme.mutedInk }}> /yr</span>
          </div>
        </div>
      </div>
      <Caption theme={theme}>GoodStrata does the same admin. For $0.</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 8: you still decide (façade brand treatment + Approve tap) -------
// Closes the clip — no logo end-card. The final VO line "See your number.
// It's free." lands as a caption swap over the last ~1.7s.
const Scene8: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 8);
  // cursor moves in and taps the Approve button around frame 52 ("you decide")
  const cursorX = interpolate(frame, [20, 52], [220, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  const cursorY = interpolate(frame, [20, 52], [160, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  const tap = interpolate(frame, [52, 60, 70], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glow = interpolate(frame, [52, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_OUT,
  });
  // Final CTA caption swap at local frame 81 (~35.3s global).
  const showCta = frame >= 81;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* soft eucalypt gradient standing in for the apartment façade (sc.8) */}
      <KenBurns
        durationInFrames={SCENES.s8.dur}
        from={1.04}
        to={1.12}
        translate={[0, -14]}
        background={`linear-gradient(155deg, ${theme.accent} 0%, color-mix(in oklch, ${theme.primary} 22%, ${theme.paper}) 55%, color-mix(in oklch, ${theme.bandBg} 30%, ${theme.paper}) 100%)`}
      >
        {/* faint building-mullion lines to imply a façade */}
        <AbsoluteFill style={{ opacity: 0.16 }}>
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: `${8 + i * 11}%`,
                top: 0,
                bottom: 0,
                width: 3,
                background: theme.primaryStrong,
              }}
            />
          ))}
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`h${i}`}
              style={{
                position: "absolute",
                top: `${10 + i * 16}%`,
                left: 0,
                right: 0,
                height: 3,
                background: theme.primaryStrong,
              }}
            />
          ))}
        </AbsoluteFill>
      </KenBurns>

      {/* decision card (scaled ~1.5x) */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            opacity: enter.opacity,
            transform: `translateY(${enter.translateY}px)`,
            width: 860,
            background: theme.card,
            border: `1.5px solid ${theme.line}`,
            borderRadius: 28,
            padding: "52px 56px 50px",
            boxShadow: "0 60px 130px -60px rgba(15,20,28,0.65)",
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
            Decision required
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
            Dispatch plumber for roof leak
          </div>
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 30,
              color: theme.mutedInk,
              marginTop: 10,
            }}
          >
            Quote $420 · within the $1,000 committee limit
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
                position: "relative",
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

          {/* tap ripple + cursor over the Approve button */}
          <div
            style={{
              position: "absolute",
              left: 230,
              bottom: 68,
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
      </AbsoluteFill>
      {showCta ? (
        <Caption theme={theme}>See your number. It&apos;s free.</Caption>
      ) : (
        <Caption theme={theme}>You still decide everything that matters</Caption>
      )}
    </AbsoluteFill>
  );
};

// ---- The composition --------------------------------------------------------
export const C1TheNumber: React.FC<C1Props> = () => {
  return (
    <AbsoluteFill style={{ background: theme.paper }}>
      {/* ElevenLabs en-AU narration — muxed into both mp4 + webm. The homepage
          cut plays muted via the <video muted> attribute, so the track rides
          along and a tap unmutes it. */}
      <Audio src={staticFile("audio/c1-vo.mp3")} />

      <Sequence from={SCENES.s1.from} durationInFrames={SCENES.s1.dur}>
        <SceneFade>
          <Scene1 />
        </SceneFade>
      </Sequence>
      <Sequence from={SCENES.s2.from} durationInFrames={SCENES.s2.dur}>
        <SceneFade>
          <Scene2 />
        </SceneFade>
      </Sequence>
      <Sequence from={SCENES.s3.from} durationInFrames={SCENES.s3.dur}>
        <SceneFade>
          <Scene3 />
        </SceneFade>
      </Sequence>
      <Sequence from={SCENES.s4.from} durationInFrames={SCENES.s4.dur}>
        <SceneFade>
          <Scene4 />
        </SceneFade>
      </Sequence>
      <Sequence from={SCENES.s5.from} durationInFrames={SCENES.s5.dur}>
        <SceneFade>
          <Scene5 />
        </SceneFade>
      </Sequence>
      <Sequence from={SCENES.s6.from} durationInFrames={SCENES.s6.dur}>
        <SceneFade>
          <Scene6 />
        </SceneFade>
      </Sequence>
      <Sequence from={SCENES.s7.from} durationInFrames={SCENES.s7.dur}>
        <SceneFade>
          <Scene7 />
        </SceneFade>
      </Sequence>
      <Sequence from={SCENES.s8.from} durationInFrames={SCENES.s8.dur}>
        <SceneFade>
          <Scene8 />
        </SceneFade>
      </Sequence>
    </AbsoluteFill>
  );
};
