/* eslint-disable @typescript-eslint/no-deprecated --
 * React 19 deprecated react-test-renderer, and it is still the only way to
 * render a React Native tree with no DOM: this suite runs under
 * `environment: 'node'`, and @testing-library/react-native 14 sits on top of
 * the same renderer anyway. The deprecation is contained in this one file so
 * no test file touches the deprecated API — replace the two calls below when a
 * DOM-free successor ships, and every suite follows for free.
 */
import type { ReactElement } from 'react';
import TestRenderer, { act, type ReactTestRendererJSON } from 'react-test-renderer';

/** One rendered node. Re-exported so tests never import the deprecated type. */
export type RenderedNode = ReactTestRendererJSON;

/**
 * Renders a React Native component tree in the node test environment.
 *
 * `react-native` itself ships Flow-typed source that rollup cannot parse, so
 * every suite using this helper mocks `react-native` down to host strings
 * (`View`, `Text`) first — see `learnings.md`, "A node-environment test that
 * imports react-native fails as Expected 'from', got 'typeOf'". The mock has to
 * live in the test file because `vi.mock` is hoisted per module; only the tree
 * walking below is shared.
 */
export function render(element: ReactElement): ReactTestRendererJSON | null {
  return mount(element).tree();
}

/**
 * Renders once and keeps the renderer, for a test that drives the component.
 *
 * `render` returns one snapshot, and a snapshot's handler props close over the
 * state of the render that produced them: calling `onPress` on it after an
 * `onChangeText` runs the OLD handler against the OLD text. Read `tree()` again
 * after every `act` to reach the handlers the component is rendering now.
 */
export function mount(element: ReactElement): {
  readonly tree: () => ReactTestRendererJSON | null;
  /**
   * Re-renders the SAME component instance with new props, keeping its state:
   * what a recycling list (FlashList) does when it reuses a cell for another item.
   */
  readonly update: (next: ReactElement) => void;
} {
  // React 19 renders through a concurrent root: without this flag `act` does
  // not flush, and every `toJSON()` comes back null — which reads as "the
  // component rendered nothing" and quietly passes the wrong assertions.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let renderer: TestRenderer.ReactTestRenderer | null = null;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  // The tree is only committed once `act` returns, so this cannot move inside.
  const committed = renderer as TestRenderer.ReactTestRenderer | null;
  return {
    tree: () => (committed === null ? null : (committed.toJSON() as ReactTestRendererJSON | null)),
    update: (next) => {
      act(() => {
        committed?.update(next);
      });
    },
  };
}

/** Every node in the tree, parents before children. */
export function nodes(tree: ReactTestRendererJSON | null): ReactTestRendererJSON[] {
  if (tree === null) return [];
  const children = (tree.children ?? []).filter(
    (child): child is ReactTestRendererJSON => typeof child !== 'string',
  );
  return [tree, ...children.flatMap(nodes)];
}

/** All rendered strings, joined — what a sighted user can actually read. */
export function text(tree: ReactTestRendererJSON | null): string {
  if (tree === null) return '';
  return (tree.children ?? [])
    .map((child) => (typeof child === 'string' ? child : text(child)))
    .join('');
}

/** The first node carrying this testID, or `undefined`. */
export function byTestId(
  tree: ReactTestRendererJSON | null,
  testID: string,
): ReactTestRendererJSON | undefined {
  return nodes(tree).find((node) => node.props['testID'] === testID);
}

/**
 * Style props arrive as a nested array of `StyleSheet.create` entries. Flatten
 * them the way the native side would, so an assertion can read one object.
 */
export function style(node: ReactTestRendererJSON): Record<string, unknown> {
  const flatten = (value: unknown): Record<string, unknown>[] => {
    if (Array.isArray(value)) return value.flatMap(flatten);
    if (typeof value === 'object' && value !== null) return [value as Record<string, unknown>];
    return [];
  };
  return Object.assign({}, ...flatten(node.props['style'])) as Record<string, unknown>;
}
