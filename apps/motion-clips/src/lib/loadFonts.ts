import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Load the four self-hosted woff2 the site uses (copied into public/fonts).
// Variable families are loaded once; IBM Plex Mono per weight (400/500/600).
export const fontsReady = Promise.all([
  loadFont({
    family: "Public Sans Variable",
    url: staticFile("fonts/public-sans-latin-wght-normal.woff2"),
    weight: "100 900",
    format: "woff2",
  }),
  loadFont({
    family: "Newsreader Variable",
    url: staticFile("fonts/newsreader-latin-wght-normal.woff2"),
    weight: "200 800",
    format: "woff2",
  }),
  loadFont({
    family: "IBM Plex Mono",
    url: staticFile("fonts/ibm-plex-mono-latin-400-normal.woff2"),
    weight: "400",
    format: "woff2",
  }),
  loadFont({
    family: "IBM Plex Mono",
    url: staticFile("fonts/ibm-plex-mono-latin-500-normal.woff2"),
    weight: "500",
    format: "woff2",
  }),
  loadFont({
    family: "IBM Plex Mono",
    url: staticFile("fonts/ibm-plex-mono-latin-600-normal.woff2"),
    weight: "600",
    format: "woff2",
  }),
]);
