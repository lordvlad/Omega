/**
 * Dark purple/teal theme.
 *
 * Purple is the primary — it carries the agent's own voice and every active
 * control — and teal is the accent, reserved for the planning surface and for
 * anything the user is being asked to decide. Keeping the two roles apart is
 * what makes the plan review read as a distinct mode rather than more chat.
 */
import { createTheme, type MantineColorsTuple, virtualColor } from "@mantine/core";

/** Primary: violet, darkened at the top end so filled buttons hold white text. */
const plum: MantineColorsTuple = [
  "#f6ecff",
  "#e7d6fb",
  "#cbaaf2",
  "#ae7bea",
  "#9654e3",
  "#873cdf",
  "#802fde",
  "#6d22c5",
  "#611cb0",
  "#54129b",
];

/** Accent: cyan, used for the plan surface and confirmations. */
const cyan: MantineColorsTuple = [
  "#e1fcff",
  "#c8f7fc",
  "#95eef9",
  "#5de4f7",
  "#31dbf5",
  "#14d6f5",
  "#00d3f6",
  "#00bbdc",
  "#00a6c5",
  "#008fad",
];

/**
 * Neutrals with a violet cast, so large dark surfaces sit in the same family
 * as the primary instead of reading as flat grey next to it.
 */
const slate: MantineColorsTuple = [
  "#f4f2f8",
  "#e5e2ea",
  "#c8c3d3",
  "#a9a1bd",
  "#8f85ab",
  "#7f73a0",
  "#776a9c",
  "#655a88",
  "#5a4f7b",
  "#4d436d",
];

export const theme = createTheme({
  primaryColor: "plum",
  primaryShade: { dark: 5, light: 6 },
  autoContrast: true,
  luminanceThreshold: 0.35,
  colors: {
    plum,
    cyan,
    dark: [
      "#eceaf2",
      "#bdb8c9",
      "#9990ab",
      "#6f6588",
      "#4b4262",
      "#3a3350",
      "#2b2540",
      "#221d34",
      "#191527",
      "#110e1c",
    ],
    slate,
    // Named so components can ask for "accent" without knowing which hue it
    // resolves to, and so a light scheme could remap it in one place.
    accent: virtualColor({ name: "accent", dark: "cyan", light: "cyan" }),
  },
  defaultRadius: "md",
  fontFamily:
    "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
  fontFamilyMonospace: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
  headings: { fontWeight: "650" },
  components: {
    // Touch targets: the phone is the primary client, so controls default to
    // a size that is comfortable with a thumb.
    Button: { defaultProps: { size: "md" } },
    ActionIcon: { defaultProps: { size: "lg", variant: "subtle" } },
    TextInput: { defaultProps: { size: "md" } },
    Textarea: { defaultProps: { size: "md" } },
    Select: { defaultProps: { size: "md" } },
    Tooltip: { defaultProps: { withArrow: true } },
  },
});
