/**
 * A `react-native` (and friends) stand-in that renders whole screens under
 * `environment: 'node'`, for a suite that mounts routes rather than one
 * component (S-157, S-54).
 *
 * `react-native` itself ships Flow source the test transform cannot parse
 * (learnings.md), so every rendering suite mocks it. One component at a time
 * gets by with `{ View: 'View', Text: 'Text' }`; a screen reaches lists,
 * modals, `Animated`, `Platform`, `Linking` and Reanimated, so the stand-in
 * lives here once. Each suite still calls `vi.mock` itself (it is hoisted per
 * file) and returns these from the factory:
 *
 *     vi.mock('react-native', async () => (await import('./native-mock')).reactNative);
 *
 * Host components stay plain strings (`'View'`, `'Pressable'`), so a test
 * reads props exactly as the native side would receive them. Lists render
 * every item, their header, footer and empty component, so a list screen's
 * rows and its empty state are both in the tree.
 */
import { createElement, Fragment, type ReactNode } from 'react';

type Props = Record<string, unknown>;

/** Renders a slot that may be a component, an element, or nothing. */
function slot(value: unknown): ReactNode {
  if (value === null || value === undefined || value === false) return null;
  if (typeof value === 'function') return createElement(value as () => ReactNode);
  return value as ReactNode;
}

/** FlatList / FlashList / SectionList: every row, plus the list's chrome. */
function List(props: Props) {
  const data = (props['data'] as readonly unknown[] | null | undefined) ?? [];
  const renderItem = props['renderItem'] as
    | ((info: { item: unknown; index: number }) => ReactNode)
    | undefined;
  const keyOf = props['keyExtractor'] as ((item: unknown, index: number) => string) | undefined;
  const Separator = props['ItemSeparatorComponent'];
  const rows = data.map((item, index) =>
    createElement(
      Fragment,
      { key: keyOf ? keyOf(item, index) : String(index) },
      index > 0 ? slot(Separator) : null,
      renderItem ? renderItem({ item, index }) : null,
    ),
  );
  const { testID, accessibilityLabel, refreshControl } = props;
  return createElement(
    'ScrollView',
    { testID, accessibilityLabel, refreshing: props['refreshing'], onRefresh: props['onRefresh'] },
    slot(refreshControl),
    slot(props['ListHeaderComponent']),
    data.length === 0 ? slot(props['ListEmptyComponent']) : rows,
    slot(props['ListFooterComponent']),
  );
}

class AnimatedValue {
  constructor(private value: number) {}
  setValue(next: number) {
    this.value = next;
  }
  interpolate() {
    return this;
  }
  stopAnimation() {
    return undefined;
  }
  valueOf() {
    return this.value;
  }
}

const animation = () => ({
  start: (done?: (r: { finished: boolean }) => void) => done?.({ finished: true }),
  stop: () => undefined,
  reset: () => undefined,
});

const flatten = (style: unknown): Props => {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten)) as Props;
  return typeof style === 'object' && style !== null ? (style as Props) : {};
};

export const reactNative = {
  View: 'View',
  Text: 'Text',
  Pressable: 'Pressable',
  TouchableOpacity: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  Image: 'Image',
  Switch: 'Switch',
  Modal: 'Modal',
  KeyboardAvoidingView: 'View',
  SafeAreaView: 'View',
  ActivityIndicator: 'ActivityIndicator',
  RefreshControl: 'RefreshControl',
  FlatList: List,
  SectionList: List,
  StyleSheet: {
    create: <T,>(sheet: T) => sheet,
    hairlineWidth: 1,
    flatten,
    absoluteFill: {},
    absoluteFillObject: {},
  },
  Platform: {
    OS: 'android',
    Version: 34,
    select: (choices: Props) => choices['android'] ?? choices['default'],
  },
  Alert: { alert: () => undefined },
  Linking: {
    openURL: () => Promise.resolve(),
    openSettings: () => Promise.resolve(),
    canOpenURL: () => Promise.resolve(true),
  },
  AccessibilityInfo: {
    announceForAccessibility: () => undefined,
    isReduceMotionEnabled: () => Promise.resolve(false),
    isScreenReaderEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove: () => undefined }),
  },
  AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  BackHandler: { addEventListener: () => ({ remove: () => undefined }) },
  Keyboard: { dismiss: () => undefined, addListener: () => ({ remove: () => undefined }) },
  Dimensions: { get: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }) },
  PixelRatio: { get: () => 2, getFontScale: () => 1, roundToNearestPixel: (n: number) => n },
  useWindowDimensions: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
  useColorScheme: () => 'light',
  Animated: {
    View: 'View',
    Text: 'Text',
    Image: 'Image',
    ScrollView: 'ScrollView',
    Value: AnimatedValue,
    timing: animation,
    spring: animation,
    decay: animation,
    sequence: animation,
    parallel: animation,
    stagger: animation,
    loop: animation,
    delay: animation,
    event: () => () => undefined,
    createAnimatedComponent: (component: unknown) => component,
  },
  Easing: {
    bezier: () => (t: number) => t,
    linear: (t: number) => t,
    ease: (t: number) => t,
    in: (f: unknown) => f,
    out: (f: unknown) => f,
    inOut: (f: unknown) => f,
  },
};

/** A chainable entering/exiting preset: `FadeIn.duration(200).delay(50)`. */
const preset: Record<string, unknown> = new Proxy(
  {},
  { get: (_target, key) => (key === 'then' ? undefined : () => preset) },
);

export const reanimated = {
  __esModule: true,
  default: {
    View: 'View',
    Text: 'Text',
    ScrollView: 'ScrollView',
    Image: 'Image',
    createAnimatedComponent: (component: unknown) => component,
  },
  useSharedValue: <T,>(value: T) => ({ value }),
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
  useReducedMotion: () => false,
  withSpring: <T,>(value: T) => value,
  withTiming: <T,>(value: T) => value,
  withSequence: <T,>(...values: T[]) => values.at(-1),
  withRepeat: <T,>(value: T) => value,
  withDelay: <T,>(_ms: number, value: T) => value,
  cancelAnimation: () => undefined,
  interpolate: (value: number) => value,
  interpolateColor: () => 'transparent',
  runOnJS: <F,>(fn: F) => fn,
  Easing: reactNative.Easing,
  ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
  FadeIn: preset,
  FadeOut: preset,
  FadeInDown: preset,
  FadeInUp: preset,
  FadeOutDown: preset,
  SlideInDown: preset,
  SlideOutDown: preset,
  LinearTransition: preset,
  Layout: preset,
};

export const safeArea = {
  SafeAreaProvider: ({ children }: { children?: ReactNode }) => children,
  SafeAreaView: 'View',
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
};

export const vectorIcons = {
  MaterialCommunityIcons: 'MaterialCommunityIcons',
  Ionicons: 'Ionicons',
  default: 'MaterialCommunityIcons',
};

export const flashList = { FlashList: List };
