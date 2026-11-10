/**
 * "Clean Pass" design tokens.
 * Concrete paper, graphite ink and a lime clean-edge accent. Uncertain values
 * are amber and dashed; confirmed values are crisp with a lime/olive tick.
 */

const light = {
  text: '#15171A',
  tint: '#15171A',

  background: '#F2F0EB',
  foreground: '#15171A',

  card: '#FFFFFF',
  cardForeground: '#15171A',
  cardAlt: '#F7F6F2',

  primary: '#15171A',
  primaryForeground: '#F4F3EF',

  secondary: '#E8E5DE',
  secondaryForeground: '#15171A',

  muted: '#ECE9E3',
  mutedForeground: '#62666C',
  faint: '#9A9DA2',

  accent: '#C8F23C',
  accentForeground: '#15171A',
  /** Lime is for dark surfaces; on light surfaces confirmed marks use olive ink. */
  confirm: '#4E7A0B',
  confirmSoft: '#EEF6D8',

  uncertain: '#A9650B',
  uncertainSoft: '#FFF3DC',
  uncertainBorder: '#E2B160',

  destructive: '#C2382C',
  destructiveForeground: '#FFFFFF',
  destructiveSoft: '#FBE8E5',

  border: '#E2DED6',
  input: '#D9D5CC',
  overlay: 'rgba(21,23,26,0.45)',
  shadow: '#000000',

  hero: '#16181B',
  heroBorder: '#16181B',
  heroForeground: '#F4F3EF',
  heroMuted: '#9EA2A8',
  heroLine: '#2A2D31',
  heroWarn: '#F2B84B',
  heroDanger: '#FF8A80',
  /** Translucent fills used only on the dark hero surface. */
  heroGlass: 'rgba(255,255,255,0.08)',
  heroGlassSoft: 'rgba(255,255,255,0.06)',
  heroGlassStrong: 'rgba(255,255,255,0.12)',
  heroGlassBorder: 'rgba(255,255,255,0.14)',
  heroAccentSoft: 'rgba(200,242,60,0.14)',
  heroDangerSoft: 'rgba(255,107,94,0.16)',
};

const dark: typeof light = {
  text: '#F1F0EC',
  tint: '#C8F23C',

  background: '#0D0E10',
  foreground: '#F1F0EC',

  card: '#18191C',
  cardForeground: '#F1F0EC',
  cardAlt: '#1F2125',

  primary: '#C8F23C',
  primaryForeground: '#15171A',

  secondary: '#25272B',
  secondaryForeground: '#F1F0EC',

  muted: '#222428',
  mutedForeground: '#A0A4AA',
  faint: '#6E7278',

  accent: '#C8F23C',
  accentForeground: '#15171A',
  confirm: '#BEE84A',
  confirmSoft: 'rgba(200,242,60,0.12)',

  uncertain: '#F2B84B',
  uncertainSoft: 'rgba(242,184,75,0.12)',
  uncertainBorder: '#8A6628',

  destructive: '#FF6B5E',
  destructiveForeground: '#15171A',
  destructiveSoft: 'rgba(255,107,94,0.12)',

  border: '#2A2C30',
  input: '#34373C',
  overlay: 'rgba(0,0,0,0.6)',
  shadow: '#000000',

  hero: '#16181B',
  heroBorder: '#2C2F34',
  heroForeground: '#F4F3EF',
  heroMuted: '#9EA2A8',
  heroLine: '#2A2D31',
  heroWarn: '#F2B84B',
  heroDanger: '#FF8A80',
  /** Translucent fills used only on the dark hero surface. */
  heroGlass: 'rgba(255,255,255,0.08)',
  heroGlassSoft: 'rgba(255,255,255,0.06)',
  heroGlassStrong: 'rgba(255,255,255,0.12)',
  heroGlassBorder: 'rgba(255,255,255,0.14)',
  heroAccentSoft: 'rgba(200,242,60,0.14)',
  heroDangerSoft: 'rgba(255,107,94,0.16)',
};

const colors = {
  light,
  dark,
  radius: 14,
};

export type Palette = typeof light;

/**
 * The customer's quote is drawn on fixed "paper" in light and dark mode so it
 * matches the PDF exactly.
 */
export const paper = {
  sheet: '#FFFFFF',
  edge: '#D9D5CC',
  shadow: '#000000',
  ink: '#16181B',
  muted: '#5C6166',
  rule: '#E7E3DB',
  ruleStrong: '#CFCBC2',
  wash: '#F4F2ED',
  included: '#4E6B0E',
  accentBar: '#8FB31A',
  sampleBg: '#FFF3DC',
  sampleBorder: '#E2B160',
  sampleInk: '#A9650B',
};
export default colors;
