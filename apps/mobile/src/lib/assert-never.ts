/**
 * The `default` of every `switch` over a union (I1).
 *
 * The parameter is `never`, so a union member that gains no `case` is a type
 * error at the switch — the compiler names the case nobody wrote. At runtime it
 * throws, because reaching it means a value arrived that the types said could
 * not exist, and carrying on would render a guess.
 */
export function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
