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
import { Caption } from "../lib/Caption";
import { KenBurns } from "../lib/KenBurns";
import "../lib/loadFonts";
import { MusicBed } from "../lib/MusicBed";
import { SceneFade } from "../lib/SceneFade";
import { fonts, light, type Theme } from "../theme";

export type C5Props = Record<string, never>;

// ---- Scene timing (30fps) ---------------------------------------------------
// Timed to public/audio/c5-vo.mp3 (20.67s). Boundaries at VO silences
// (ffmpeg silencedetect): 0 · 5.46 · 8.48 · 10.77 · 13.07 · 15.75 · 19.64.
export const SCENES = {
  s1: { from: 0, dur: 164 }, // "84% of Victorian schemes are 10 lots or fewer"
  s2: { from: 164, dur: 90 }, // "~40% already run themselves"
  s3: { from: 254, dur: 69 }, // "There was no handbook"
  s4: { from: 323, dur: 69 }, // "So we built one — that runs itself"
  s5: { from: 392, dur: 81 }, // "Free. Open source. Yours."
  s6: { from: 473, dur: 116 }, // "One owner can move a building"
  s7: { from: 589, dur: 31 }, // payoff "Rally yours."
} as const;
export const C5_DURATION = 620; // 20.67s @ 30fps

const theme: Theme = light;

// A small block glyph for the suburban street (a stacked-plate walk-up).
const Block: React.FC<{ state: "off" | "lit" | "green" }> = ({ state }) => {
  const body =
    state === "green"
      ? theme.primary
      : state === "lit"
        ? theme.card
        : `color-mix(in oklch, ${theme.card} 55%, ${theme.paper})`;
  const border = state === "green" ? theme.primaryStrong : theme.line;
  const win =
    state === "green"
      ? `color-mix(in oklch, ${theme.onPrimary} 85%, transparent)`
      : state === "lit"
        ? theme.accent
        : `color-mix(in oklch, ${theme.line} 60%, transparent)`;
  return (
    <div
      style={{
        width: 116,
        background: body,
        border: `2px solid ${border}`,
        borderRadius: 10,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: state === "off" ? "none" : "0 24px 44px -30px rgba(15,20,28,0.5)",
      }}
    >
      {Array.from({ length: 3 }).map((_, r) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid
          key={r}
          style={{ display: "flex", gap: 8, justifyContent: "center" }}
        >
          {Array.from({ length: 2 }).map((_, c) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid
              key={c}
              style={{ width: 38, height: 26, borderRadius: 3, background: win }}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

const N_BLOCKS = 10;

const Street: React.FC<{ litCount: number; greenCount?: number }> = ({
  litCount,
  greenCount = 0,
}) => (
  <div style={{ display: "flex", gap: 22, alignItems: "flex-end" }}>
    {Array.from({ length: N_BLOCKS }).map((_, i) => (
      <Block
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed street
        key={i}
        state={i < greenCount ? "green" : i < litCount ? "lit" : "off"}
      />
    ))}
  </div>
);

// A cork noticeboard, optionally holding a pinned one-pager.
const Noticeboard: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: "relative",
      width: 900,
      height: 620,
      borderRadius: 18,
      background: `color-mix(in oklch, ${theme.accent} 30%, ${theme.card})`,
      border: `18px solid color-mix(in oklch, ${theme.primaryStrong} 30%, ${theme.card})`,
      boxShadow: "0 60px 130px -60px rgba(15,20,28,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    }}
  >
    {children}
  </div>
);

const OnePager: React.FC = () => (
  <div
    style={{
      width: 440,
      height: 560,
      background: theme.card,
      border: `1.5px solid ${theme.line}`,
      borderRadius: 10,
      padding: "36px 34px",
      boxShadow: "0 30px 70px -40px rgba(15,20,28,0.5)",
      transform: "rotate(-2deg)",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          fontFamily: fonts.sans,
          fontWeight: 800,
          fontSize: 34,
          color: theme.ink,
        }}
      >
        Good<span style={{ color: theme.primary }}>Strata</span>
      </span>
    </div>
    <div
      style={{
        fontFamily: fonts.sans,
        fontWeight: 700,
        fontSize: 28,
        color: theme.ink,
        marginTop: 20,
      }}
    >
      Run your own building
    </div>
    {[
      "Levies, apportioned to the cent",
      "Arrears chased automatically",
      "Minutes drafted for you",
      "Free · open source",
    ].map((t) => (
      <div
        key={t}
        style={{
          display: "flex",
          gap: 12,
          fontFamily: fonts.sans,
          fontSize: 22,
          color: theme.mutedInk,
          marginTop: 16,
        }}
      >
        <span style={{ color: theme.primary }}>✓</span>
        {t}
      </div>
    ))}
  </div>
);

// ---- Scene 1: a street of small blocks lights up one by one ----------------
const Scene1: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const lit = Math.round(
    interpolate(frame, [12, 140], [0, N_BLOCKS], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_OUT,
    }),
  );
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 60,
      }}
    >
      <div
        style={{
          textAlign: "center",
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        <span
          style={{
            fontFamily: fonts.mono,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            fontSize: 180,
            color: theme.primary,
            letterSpacing: "-0.03em",
          }}
        >
          84%
        </span>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 600,
            fontSize: 40,
            color: theme.mutedInk,
            marginTop: -6,
          }}
        >
          of Victorian schemes: 10 lots or fewer
        </div>
      </div>
      <Street litCount={lit} />
      <Caption theme={theme}>84% of Victorian schemes are 10 lots or fewer</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 2: ~40% of the blocks turn eucalypt -----------------------------
const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 4);
  const green = Math.round(
    interpolate(frame, [8, 54], [0, 4], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: EASE_IN_OUT,
    }),
  );
  return (
    <AbsoluteFill
      style={{
        background: theme.paper,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 60,
      }}
    >
      <div
        style={{
          textAlign: "center",
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        <span
          style={{
            fontFamily: fonts.mono,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            fontSize: 180,
            color: theme.primary,
            letterSpacing: "-0.03em",
          }}
        >
          ~40%
        </span>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 600,
            fontSize: 40,
            color: theme.mutedInk,
            marginTop: -6,
          }}
        >
          already self-manage
        </div>
      </div>
      <Street litCount={N_BLOCKS} greenCount={green} />
      <Caption theme={theme}>~40% already run themselves</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 3: a blank noticeboard — no handbook ----------------------------
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
          opacity: enter.opacity,
          transform: `translateY(${enter.translateY}px)`,
        }}
      >
        <Noticeboard>
          <div
            style={{
              fontFamily: fonts.sans,
              fontWeight: 700,
              fontSize: 48,
              color: `color-mix(in oklch, ${theme.mutedInk} 60%, ${theme.accent})`,
              opacity: 0.5,
            }}
          >
            (nothing pinned)
          </div>
          {/* a few empty pins */}
          {[
            [80, 70],
            [760, 90],
            [120, 520],
          ].map(([l, t]) => (
            <div
              key={`${l}-${t}`}
              style={{
                position: "absolute",
                left: l,
                top: t,
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: theme.line,
              }}
            />
          ))}
        </Noticeboard>
      </div>
      <Caption theme={theme}>There was no handbook</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 4: the GoodStrata dashboard resolves into view ------------------
const Scene4: React.FC = () => {
  const frame = useCurrentFrame();
  const resolve = interpolate(frame, [0, 40], [0, 1], {
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
          opacity: resolve,
          filter: `blur(${(1 - resolve) * 18}px)`,
          transform: `scale(${0.94 + resolve * 0.06})`,
          width: 1280,
          background: theme.card,
          border: `1.5px solid ${theme.line}`,
          borderRadius: 22,
          padding: "38px 44px 46px",
          boxShadow: "0 60px 130px -60px rgba(15,20,28,0.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span
            style={{
              fontFamily: fonts.sans,
              fontWeight: 800,
              fontSize: 40,
              color: theme.ink,
            }}
          >
            Good<span style={{ color: theme.primary }}>Strata</span>
          </span>
          <span
            style={{
              fontFamily: fonts.mono,
              fontSize: 24,
              color: theme.faintInk,
            }}
          >
            · your building, running itself
          </span>
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 30 }}>
          {[
            ["Unallocated", "$0.00"],
            ["Audited events", "110"],
            ["Decisions waiting", "1"],
          ].map(([k, v]) => (
            <div
              key={k}
              style={{
                flex: 1,
                background: theme.paper,
                border: `1.5px solid ${theme.line}`,
                borderRadius: 16,
                padding: "26px 30px",
              }}
            >
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 24,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: theme.faintInk,
                }}
              >
                {k}
              </div>
              <div
                style={{
                  fontFamily: fonts.mono,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                  fontSize: 64,
                  color: theme.primary,
                  marginTop: 8,
                }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>
      <Caption theme={theme}>So we built one — that runs itself</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 5: the one-pager slides onto the noticeboard --------------------
const Scene5: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 2);
  const slide = interpolate(frame, [8, 40], [-900, 0], {
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
        <Noticeboard>
          <div style={{ transform: `translateX(${slide}px)` }}>
            <OnePager />
          </div>
        </Noticeboard>
      </div>
      <Caption theme={theme}>Free. Open source. Yours.</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 6: a hand pins the one-pager (subtle parallax) ------------------
const Scene6: React.FC = () => {
  const frame = useCurrentFrame();
  const { dur } = SCENES.s6;
  const pinPress = interpolate(frame, [10, 24], [-120, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: EASE_IN_OUT,
  });
  const pinScale = interpolate(frame, [22, 30, 40], [1, 1.25, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: theme.paper }}>
      <KenBurns durationInFrames={dur} from={1.02} to={1.08} translate={[0, -12]}>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <Noticeboard>
            <div style={{ position: "relative" }}>
              <OnePager />
              {/* the pin pressing into the top of the sheet */}
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: -26,
                  marginLeft: -18,
                  transform: `translateY(${pinPress}px) scale(${pinScale})`,
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: theme.critical,
                    boxShadow: "0 10px 20px -8px rgba(15,20,28,0.6)",
                    border: `3px solid ${theme.card}`,
                  }}
                />
              </div>
            </div>
          </Noticeboard>
        </AbsoluteFill>
      </KenBurns>
      <Caption theme={theme}>One owner can move a building</Caption>
    </AbsoluteFill>
  );
};

// ---- Scene 7: payoff — rally yours -----------------------------------------
const Scene7: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = riseIn(frame, fps, 0);
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
          transform: `translateY(${enter.translateY}px) scale(${0.96 + fade(frame, 0, 12) * 0.04})`,
          fontFamily: fonts.sans,
          fontWeight: 800,
          fontSize: 200,
          letterSpacing: "-0.03em",
          color: theme.ink,
        }}
      >
        Rally <span style={{ color: theme.primary }}>yours.</span>
      </div>
      <Caption theme={theme}>Rally yours.</Caption>
    </AbsoluteFill>
  );
};

export const C5Handbook: React.FC<C5Props> = () => (
  <AbsoluteFill style={{ background: theme.paper }}>
    <Audio src={staticFile("audio/c5-vo.mp3")} />
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
