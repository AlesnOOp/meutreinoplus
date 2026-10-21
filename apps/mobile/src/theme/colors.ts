export type Palette = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  danger: string;
  border: string;
  soft: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  dangerSoft: string;
};

export type ColorSchemeName = 'light' | 'dark';

export const palettes: Record<ColorSchemeName, Palette> = {
  light: {
    background: '#F6F6FA',
    surface: '#FFFFFF',
    text: '#202035',
    muted: '#68687D',
    accent: '#6337DB',
    accentText: '#FFFFFF',
    danger: '#C32F4E',
    border: '#E6E5EF',
    soft: '#EFEEF5',
    accentSoft: '#EDE7FF',
    success: '#267047',
    successSoft: '#E7F5EA',
    dangerSoft: '#FCEBF0',
  },
  dark: {
    background: '#101018',
    surface: '#1C1C29',
    text: '#F5F3FF',
    muted: '#ABA7BF',
    accent: '#B69AFF',
    accentText: '#21113D',
    danger: '#FF98AD',
    border: '#343245',
    soft: '#262535',
    accentSoft: '#30234B',
    success: '#8DDEA7',
    successSoft: '#193B2B',
    dangerSoft: '#402334',
  },
};
export const brand = { violet: '#6337DB', lime: '#DCFA72', coral: '#FF9C7C', ink: '#202035' };

export const planColors: Record<string, string> = {
  slate: '#667085',
  blue: '#2870CC',
  green: '#2A8053',
  amber: '#A36D0A',
  red: '#C83F58',
  violet: '#7849D8',
  teal: '#0C8285',
  pink: '#BB3F89',
};
