import Svg, { Path } from 'react-native-svg';

const paths = {
  home: 'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  layers: 'm12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',
  dumbbell: 'm6 4 14 14M4 6l2-2m12 16 2-2M2 8l6-6m8 20 6-6M4 10l6-6m4 16 6-6',
  play: 'm9 5 11 7-11 7Z',
  user: 'M20 21v-2a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v2M16 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  back: 'M19 12H5m6-6-6 6 6 6',
  chevron: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 6v6l4 2',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  shield: 'M12 2 3 6v6c0 6 9 10 9 10s9-4 9-10V6Zm-4 10 3 3 5-6',
  mail: 'M3 5h18v14H3Zm0 1 9 7 9-7',
  settings:
    'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  link: 'm10 13 4-4m-5 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 3 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  logout: 'M9 3H3v18h6m6-16 7 7-7 7M8 12h14',
  info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0M12 11v6m0-10v1',
  alert: 'm12 3 10 18H2Zm0 5v6m0 3v1',
  cloud: 'M7 18a6 6 0 1 1 11-6 3 3 0 0 1 0 6M12 13v8m-3-3 3 3 3-3',
  trophy: 'M7 3h10v8a5 5 0 0 1-10 0Zm0 2H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4m-5 4v5m-5 0h10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  eyeOff:
    'm3 3 18 18M10 5h2c6 0 10 7 10 7a24 24 0 0 1-4 4M6 6a24 24 0 0 0-4 6s4 7 10 7a12 12 0 0 0 5-1',
  pause: 'M7 4h3v16H7Zm7 0h3v16h-3Z',
  up: 'm6 14 6-6 6 6',
  down: 'm6 10 6 6 6-6',
  book: 'M12 5C8 2 3 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-1-1-6-2-10 1Zm0 0v16',
};
export type IconName = keyof typeof paths;
export function Icon({
  name,
  size = 22,
  color = 'currentColor',
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Path
        d={paths[name]}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
