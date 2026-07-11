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
import { countUp, dropIn, EASE_IN_OUT, riseIn } from "../lib/anim";
import { Caption } from "../lib/Caption";
import { FeeCard } from "../lib/FeeCard";
import { Ledger } from "../lib/Ledger";
import "../lib/loadFonts";
import { MusicBed } from "../lib/MusicBed";
import { SceneFade } from "../lib/SceneFade";
import { fonts, light, type Theme } from "../theme";

export type C4Props = Record<string, never>;

// ---- Scene timing (30fps) ---------------------------------------------------
// Timed to public/audio/c4-vo.mp3 (27.35s). Boundaries at VO silences
// (ffmpeg silencedetect): 0 · 3.33 · 5.53 · 7.79 · 10.15 · 13.15 · 17.03 · 21.60.
export const SCENES = {
  s1: { from: 0, dur: 100 }, // "This is the fee that won the tender"
  s2: { from: 100, dur: 66 }, // "$180 committee meeting"
  s3: { from: 166, dur: 68 }, // "$90 arrears notice × 34"
  s4: { from: 234, dur: 71 }, // "$600 'automated' tax report"
  s5: { from: 305, dur: 90 }, // "$945 safety report (from 2015)"
  s6: { from: 395, dur: 116 }, // "$400 → $700+"
  s7: { from: 511, dur: 137 }, // "The money is code, itemised"
  s8: { from: 648, dur: 173 }, // "See what you're really paying. It's free."
} as const;
export const C4_DURATION = 821; // 27.37s @ 30fps

const theme: Theme = light;

// The winning-tender header card, reused as the base of the growing stack.
const TenderHeader: React.FC<{ dim?: boolean }> = ({ dim = false }) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 40,
      width: 1120,
      padding: "28px 50px",
      background: `color-mix(in oklch, ${theme.accent} 60%, ${theme.card})`,
      border: `1.5px solid ${theme.primary}`,
      borderRadius: 22,
      opacity: dim ? 0.5 : 1,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: theme.primary,
          color: theme.onPrimary,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 28,
          fontWeight: 700,
        }}
      >
        ✓
      </span>
      <span
        style={{
          fontFamily: fonts.sans,
          fontWeight: 700,
          fontSize: 44,
          color: theme.accentInk,
        }}
      >
        Winning tender
      </span>
    </div>
    <span
      style={{
        fontFamily: fonts.mono,
        fontVariantNumeric: "tabular-nums",
        fontWeight: 600,
        fontSize: 58,
        color: theme.primaryStrong,
      }}
    >
      $400 / lot
    </span>
  </div>
);

// A hidden-extras running subtotal chip (critical) under the stack.
const ExtrasChip: React.FC<{ amount: string }> = ({ amount }) => (
  <div
    style={{
      marginTop: 8,
      display: "flex",
      alignItems: "center",
      gap: 18,
      alignSelf: "flex-end",
      fontFamily: fonts.mono,
      fontSize: 34,
      color: theme.critical,
    }}
  >
    <span
      style={{
        textTransform: "uppercase",
        letterSpacing: "0.1em",
        fontSize: 24,
      }}
    >
      hidden extras
    </span>
    <span style={{ fontWeight: 600, fontSize: 46 }}>{amount}</span>
  </div>
);

const Stack: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill
    style={{
      background: theme.paper,
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {children}
    </div>
  </AbsoluteFill>
);

// ---- Scene 1: the tidy $400/lot card that won the tender -------------------
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
          textAlign: "center",
        }}
      >
        <TenderHeader />
        <div
          style={{
            fontFamily: fonts.sans,
            fontSize: 34,
            color: theme.mutedInk,
            marginTop: 26,
          }}
        >
          Schedule B · “all-inclusive management fee”
        </div>
      </div>
      <Caption theme={theme}>This is the fee that won the tender</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 2: $180 committee meeting drops ---------------------------------
const Scene2: React.FC = () => (
  <Stack>
    <TenderHeader dim />
    <FeeCard theme={theme} label="Committee meeting fee" amount="$180" dropAt={6} />
    <ExtrasChip amount="$180" />
  </Stack>
);

// ---- Scene 3: $90 arrears notice × 34, red counter ticks up ----------------
const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = dropIn(frame, fps, 6);
  const count = Math.round(countUp(frame, 34, 10, 40));
  const amount = 90 * count;
  return (
    <Stack>
      <TenderHeader dim />
      <FeeCard theme={theme} label="Committee meeting fee" amount="$180" dropAt={-30} />
      <div
        style={{
          opacity: drop.opacity,
          transform: `translateY(${drop.translateY}px)`,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 44,
          width: 1120,
          padding: "34px 50px",
          background: theme.card,
          border: `1.5px solid color-mix(in oklch, ${theme.critical} 45%, ${theme.line})`,
          borderRadius: 22,
          boxShadow: "0 34px 66px -40px rgba(15,20,28,0.55)",
        }}
      >
        <span
          style={{
            fontFamily: fonts.sans,
            fontWeight: 500,
            fontSize: 46,
            color: theme.mutedInk,
          }}
        >
          Arrears notice · $90 ×{" "}
          <span
            style={{
              fontFamily: fonts.mono,
              fontVariantNumeric: "tabular-nums",
              color: theme.critical,
              fontWeight: 700,
            }}
          >
            {count}
          </span>
        </span>
        <span
          style={{
            fontFamily: fonts.mono,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            fontSize: 54,
            color: theme.critical,
          }}
        >
          ${amount.toLocaleString("en-AU")}
        </span>
      </div>
      <ExtrasChip amount="$3,240" />
    </Stack>
  );
};

// ---- Scene 4: $600 'automated' tax report lands ----------------------------
const Scene4: React.FC = () => (
  <Stack>
    <TenderHeader dim />
    <FeeCard theme={theme} label="Committee meeting fee" amount="$180" dropAt={-30} />
    <FeeCard
      theme={theme}
      label="Arrears notice · $90 × 34"
      amount="$3,060"
      tone="critical"
      dropAt={-30}
    />
    <FeeCard
      theme={theme}
      label="‘Automated’ tax report"
      amount="$600"
      greyed
      dropAt={6}
    />
    <ExtrasChip amount="$3,840" />
  </Stack>
);

// ---- Scene 5: $945 safety report, dusty 2015 stamp -------------------------
const Scene5: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = dropIn(frame, fps, 6);
  return (
    <Stack>
      <TenderHeader dim />
      <FeeCard theme={theme} label="Committee meeting fee" amount="$180" dropAt={-30} />
      <FeeCard
        theme={theme}
        label="Arrears notice · $90 × 34"
        amount="$3,060"
        tone="critical"
        dropAt={-30}
      />
      <FeeCard
        theme={theme}
        label="‘Automated’ tax report"
        amount="$600"
        greyed
        dropAt={-30}
      />
      <div
        style={{
          position: "relative",
          opacity: drop.opacity,
          transform: `translateY(${drop.translateY}px)`,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 44,
          width: 1120,
          padding: "34px 50px",
          background: `color-mix(in oklch, ${theme.card} 82%, ${theme.paper})`,
          border: `1.5px solid ${theme.line}`,
          borderRadius: 22,
          boxShadow: "0 34px 66px -40px rgba(15,20,28,0.55)",
        }}
      >
        {/* dusty 2015 stamp */}
        <div
          style={{
            position: "absolute",
            right: 300,
            top: -18,
            transform: "rotate(-9deg)",
            border: `4px solid ${theme.critical}`,
            color: theme.critical,
            opacity: 0.55,
            borderRadius: 10,
            padding: "4px 16px",
            fontFamily: fonts.mono,
            fontWeight: 700,
            fontSize: 40,
            letterSpacing: "0.08em",
          }}
        >
          2015
        </div>
        <span
          style={{
            fontFamily: fonts.sans,
            fontWeight: 500,
            fontSize: 46,
            color: theme.mutedInk,
          }}
        >
          Safety report (dated 2015)
        </span>
        <span
          style={{
            fontFamily: fonts.mono,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            fontSize: 54,
            color: theme.ink,
          }}
        >
          $945
        </span>
      </div>
      <ExtrasChip amount="$4,785" />
    </Stack>
  );
};

// ---- Scene 6: the stack collapses into one per-lot total (on band) ---------
const Scene6: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const left = riseIn(frame, fps, 4);
  const right = riseIn(frame, fps, 30);
  const strike = interpolate(frame, [30, 54], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  const big: React.CSSProperties = {
    fontFamily: fonts.mono,
    fontVariantNumeric: "tabular-nums",
    fontWeight: 600,
    fontSize: 240,
    lineHeight: 1,
    letterSpacing: "-0.02em",
  };
  return (
    <AbsoluteFill
      style={{
        background: theme.bandBg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 80 }}>
        <div
          style={{
            position: "relative",
            textAlign: "center",
            opacity: left.opacity,
            transform: `translateY(${left.translateY}px)`,
          }}
        >
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 34,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: theme.bandMuted,
              marginBottom: 18,
            }}
          >
            Tendered
          </div>
          <div style={{ ...big, color: theme.bandInk, position: "relative" }}>
            $400
            <div
              style={{
                position: "absolute",
                left: 0,
                top: "52%",
                height: 8,
                width: `${strike * 100}%`,
                background: theme.critical,
                borderRadius: 4,
              }}
            />
          </div>
        </div>
        <div
          style={{ fontFamily: fonts.sans, fontSize: 100, color: theme.bandMuted, opacity: right.opacity }}
        >
          →
        </div>
        <div
          style={{
            textAlign: "center",
            opacity: right.opacity,
            transform: `translateY(${right.translateY}px)`,
          }}
        >
          <div
            style={{
              fontFamily: fonts.mono,
              fontSize: 34,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: theme.critical,
              marginBottom: 18,
            }}
          >
            Actually
          </div>
          <div style={{ ...big, color: theme.bandFig }}>$700+</div>
        </div>
      </div>
      <Caption theme={theme} onBand>
        $400 → $700+ per lot
      </Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 7: the clean GoodStrata ledger, itemised in mono ----------------
const Scene7: React.FC = () => {
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
        }}
      >
        <Ledger
          theme={theme}
          width={1160}
          title="goodstrata · itemised — every line"
          rows={[
            ["Levy apportionment", "$0.00"],
            ["Committee meetings", "$0.00"],
            ["Arrears notices × 34", "$0.00"],
            ["Tax report (computed)", "$0.00"],
            ["Safety register", "$0.00"],
          ]}
          balanceLabel="Total to manage"
          balanceAmount="$0.00"
        />
      </div>
      <Caption theme={theme}>The money is code, itemised</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 8: payoff — see what you're really paying -----------------------
const Scene8: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = riseIn(frame, fps, 4);
  const b = riseIn(frame, fps, 18);
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 20,
      }}
    >
      <div
        style={{
          opacity: a.opacity,
          transform: `translateY(${a.translateY}px)`,
          fontFamily: fonts.mono,
          fontSize: 46,
          color: theme.mutedInk,
          textDecoration: "line-through",
          textDecorationColor: theme.critical,
        }}
      >
        $700+ / lot, hidden
      </div>
      <div
        style={{
          opacity: b.opacity,
          transform: `translateY(${b.translateY}px)`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 800,
            fontSize: 150,
            letterSpacing: "-0.03em",
            color: theme.primary,
            lineHeight: 1,
          }}
        >
          $0, itemised.
        </div>
      </div>
      <Caption theme={theme}>See what you’re really paying. It’s free.</Caption>
    </AbsoluteFill>
  );
};

export const C4ScheduleB: React.FC<C4Props> = () => (
  <AbsoluteFill style={{ background: theme.paper }}>
    <Audio src={staticFile("audio/c4-vo.mp3")} />
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
