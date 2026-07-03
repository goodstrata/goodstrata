import type React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { AgmCard } from "../lib/AgmCard";
import { countUp, dropIn, fade, riseIn } from "../lib/anim";
import { Caption } from "../lib/Caption";
import { EndCard } from "../lib/EndCard";
import { FeeCard } from "../lib/FeeCard";
import { KenBurns } from "../lib/KenBurns";
import "../lib/loadFonts";
import { fees, fonts, light, money, type Theme } from "../theme";

export type C1Props = {
  hook: "A" | "B" | "C";
};

// ---- Scene timing (30fps). 9 scenes, 840 frames = 28.0s ---------------------
export const SCENES = {
  s1: { from: 0, dur: 105 },
  s2: { from: 105, dur: 90 },
  s3: { from: 195, dur: 105 },
  s4: { from: 300, dur: 90 },
  s5: { from: 390, dur: 75 },
  s6: { from: 465, dur: 105 },
  s7: { from: 570, dur: 105 },
  s8: { from: 675, dur: 90 },
  s9: { from: 765, dur: 75 },
} as const;
export const C1_DURATION = 840;

const theme: Theme = light;

// A shared row used on the clean-UI scenes.
const MonoLine: React.FC<{
  label: string;
  amount: string;
  theme: Theme;
  strong?: boolean;
  width?: number;
}> = ({ label, amount, theme, strong, width = 640 }) => (
  <div
    style={{
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 24,
      width,
      padding: "20px 28px",
      background: theme.card,
      border: `1px solid ${theme.line}`,
      borderRadius: 14,
      boxShadow: "0 20px 40px -30px rgba(15,20,28,0.5)",
    }}
  >
    <span
      style={{
        fontFamily: fonts.sans,
        fontWeight: 600,
        fontSize: 26,
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
        fontSize: strong ? 34 : 30,
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
          width={720}
        />
      </div>
      <Caption theme={theme}>The base fee is the number they show you</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 3: fee cards drop and stack like bricks --------------------------
const Scene3: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <MonoLine
          theme={theme}
          label="Base management fee"
          amount={money(fees.base)}
          width={640}
        />
        <FeeCard
          theme={theme}
          label="+ Disbursements & sundries"
          amount={money(fees.disbursements)}
          dropAt={8}
        />
        <FeeCard
          theme={theme}
          label="+ Meeting & AGM fees"
          amount={money(fees.meetings)}
          dropAt={26}
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
  const { opacity, translateY } = riseIn(frame, fps, 6, 14);
  const shadow = interpolate(frame, [6, 30], [0.25, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ opacity: 0.4 }}>
          <MonoLine
            theme={theme}
            label="Base + extras"
            amount={money(fees.base + fees.disbursements + fees.meetings)}
            width={640}
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
              gap: 24,
              width: 640,
              padding: "20px 28px",
              background: `color-mix(in oklch, ${theme.card} 78%, ${theme.paper})`,
              border: `1px solid color-mix(in oklch, ${theme.critical} 40%, ${theme.line})`,
              borderRadius: 14,
            }}
          >
            <span
              style={{
                fontFamily: fonts.sans,
                fontWeight: 500,
                fontSize: 26,
                color: theme.faintInk,
              }}
            >
              Insurance commission
            </span>
            <span
              style={{
                fontFamily: fonts.mono,
                fontWeight: 500,
                fontSize: 28,
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
  const { fps, durationInFrames } = useVideoConfig();
  // shutter flash around frame 14
  const flash = interpolate(frame, [12, 16, 22], [0, 0.75, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const spin = (frame / fps) * 360; // spinner rotation
  const uiEnter = riseIn(frame, fps, 24);
  const phoneExit = fade(frame, 24, 34, 1, 0);

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
            width: 300,
            height: 600,
            borderRadius: 44,
            border: `10px solid ${theme.ink}`,
            background: theme.card,
            boxShadow: "0 40px 90px -50px rgba(15,20,28,0.7)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ transform: "scale(0.34)" }}>
            <AgmCard theme={theme} />
          </div>
        </div>
      </div>

      {/* upload spinner card */}
      <div
        style={{
          opacity: uiEnter.opacity,
          transform: `translateY(${uiEnter.translateY}px)`,
          width: 520,
          padding: "36px 40px",
          background: theme.card,
          border: `1px solid ${theme.line}`,
          borderRadius: 16,
          boxShadow: "0 24px 50px -34px rgba(15,20,28,0.5)",
          display: "flex",
          alignItems: "center",
          gap: 22,
        }}
      >
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            border: `4px solid ${theme.line}`,
            borderTopColor: theme.primary,
            transform: `rotate(${spin}deg)`,
          }}
        />
        <div>
          <div
            style={{
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 24,
              color: theme.ink,
            }}
          >
            Reading your AGM pack…
          </div>
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 16,
              color: theme.faintInk,
              marginTop: 4,
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
      {/* keep durationInFrames referenced for clarity */}
      {frame > durationInFrames ? null : null}
    </AbsoluteFill>
  );
};

// ---- Scene 6: the real total counts up on the deep-eucalypt band ------------
const Scene6: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const value = countUp(frame, fees.total, 10, 30);
  const enter = riseIn(frame, fps, 4);
  const breakdownOpacity = fade(frame, 40, 55);

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
          fontSize: 22,
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
          fontSize: 200,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: theme.bandFig,
          marginTop: 12,
        }}
      >
        {money(value)}
        <span style={{ fontSize: 64, color: theme.bandMuted }}> /yr</span>
      </div>
      <div
        style={{
          marginTop: 26,
          fontFamily: fonts.mono,
          fontSize: 24,
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
const Scene7: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const left = riseIn(frame, fps, 4);
  const right = riseIn(frame, fps, 20);
  // line-through draws across the $8,400
  const strike = interpolate(frame, [26, 48], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const bigStyle: React.CSSProperties = {
    fontFamily: fonts.mono,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    fontSize: 128,
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
      <div style={{ display: "flex", alignItems: "center", gap: 90 }}>
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
              fontSize: 20,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: theme.mutedInk,
              marginBottom: 12,
            }}
          >
            A strata manager charges
          </div>
          <div style={{ ...bigStyle, color: theme.ink, position: "relative" }}>
            {money(fees.total)}
            <span style={{ fontSize: 46, color: theme.mutedInk }}> /yr</span>
            {/* the line-through, drawn like .receipt-big.struck */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: "52%",
                height: 5,
                width: `${strike * 100}%`,
                background: `color-mix(in oklch, ${theme.critical} 72%, transparent)`,
                borderRadius: 3,
              }}
            />
          </div>
        </div>

        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 60,
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
              fontSize: 20,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: theme.accentInk,
              marginBottom: 12,
            }}
          >
            With GoodStrata
          </div>
          <div style={{ ...bigStyle, color: theme.primary }}>
            $0
            <span style={{ fontSize: 46, color: theme.mutedInk }}> /yr</span>
          </div>
        </div>
      </div>
      <Caption theme={theme}>GoodStrata does the same admin. For $0.</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 8: you still decide (façade brand treatment + Approve tap) -------
const Scene8: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 6);
  // cursor moves in and taps around frame 40
  const cursorX = interpolate(frame, [16, 44], [160, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const cursorY = interpolate(frame, [16, 44], [120, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const tap = interpolate(frame, [44, 50, 58], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const glow = interpolate(frame, [44, 52], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
                width: 2,
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
                height: 2,
                background: theme.primaryStrong,
              }}
            />
          ))}
        </AbsoluteFill>
      </KenBurns>

      {/* decision card */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            opacity: enter.opacity,
            transform: `translateY(${enter.translateY}px)`,
            width: 560,
            background: theme.card,
            border: `1px solid ${theme.line}`,
            borderRadius: 18,
            padding: "34px 36px 32px",
            boxShadow: "0 40px 90px -50px rgba(15,20,28,0.65)",
            position: "relative",
          }}
        >
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 15,
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
              fontSize: 30,
              letterSpacing: "-0.02em",
              color: theme.ink,
              marginTop: 8,
            }}
          >
            Dispatch plumber for roof leak
          </div>
          <div
            style={{
              fontFamily: fonts.sans,
              fontSize: 19,
              color: theme.mutedInk,
              marginTop: 6,
            }}
          >
            Quote $420 · within the $1,000 committee limit
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 26 }}>
            <div
              style={{
                flex: 1,
                textAlign: "center",
                padding: "14px 0",
                borderRadius: 10,
                background: theme.primary,
                color: theme.onPrimary,
                fontFamily: fonts.sans,
                fontWeight: 600,
                fontSize: 22,
                position: "relative",
                boxShadow: `0 0 ${glow * 34}px ${glow * 6}px color-mix(in oklch, ${theme.primary} 60%, transparent)`,
              }}
            >
              Approve
            </div>
            <div
              style={{
                padding: "14px 26px",
                borderRadius: 10,
                border: `1px solid ${theme.line}`,
                color: theme.ink,
                fontFamily: fonts.sans,
                fontWeight: 600,
                fontSize: 22,
              }}
            >
              Hold
            </div>
          </div>

          {/* tap ripple + cursor over the Approve button */}
          <div
            style={{
              position: "absolute",
              left: 150,
              bottom: 44,
              transform: `translate(${cursorX}px, ${cursorY}px)`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: -18,
                top: -18,
                width: 60,
                height: 60,
                borderRadius: "50%",
                border: `3px solid ${theme.primary}`,
                opacity: tap,
                transform: `scale(${0.4 + tap * 1.1})`,
              }}
            />
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: theme.ink,
                opacity: 0.82,
              }}
            />
          </div>
        </div>
      </AbsoluteFill>
      <Caption theme={theme}>You still decide everything that matters</Caption>
    </AbsoluteFill>
  );
};

// ---- The composition --------------------------------------------------------
export const C1TheNumber: React.FC<C1Props> = () => {
  return (
    <AbsoluteFill style={{ background: theme.paper }}>
      <Sequence from={SCENES.s1.from} durationInFrames={SCENES.s1.dur}>
        <Scene1 />
      </Sequence>
      <Sequence from={SCENES.s2.from} durationInFrames={SCENES.s2.dur}>
        <Scene2 />
      </Sequence>
      <Sequence from={SCENES.s3.from} durationInFrames={SCENES.s3.dur}>
        <Scene3 />
      </Sequence>
      <Sequence from={SCENES.s4.from} durationInFrames={SCENES.s4.dur}>
        <Scene4 />
      </Sequence>
      <Sequence from={SCENES.s5.from} durationInFrames={SCENES.s5.dur}>
        <Scene5 />
      </Sequence>
      <Sequence from={SCENES.s6.from} durationInFrames={SCENES.s6.dur}>
        <Scene6 />
      </Sequence>
      <Sequence from={SCENES.s7.from} durationInFrames={SCENES.s7.dur}>
        <Scene7 />
      </Sequence>
      <Sequence from={SCENES.s8.from} durationInFrames={SCENES.s8.dur}>
        <Scene8 />
      </Sequence>
      <Sequence from={SCENES.s9.from} durationInFrames={SCENES.s9.dur}>
        <EndCard
          theme={theme}
          url="goodstrata.com.au/what-am-i-paying"
          cta="See your number. It's free."
        />
      </Sequence>
    </AbsoluteFill>
  );
};
