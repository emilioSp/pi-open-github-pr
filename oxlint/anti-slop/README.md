# Anti-slop Oxlint rules

This directory contains the project's custom Oxlint plugin. The plugin is focused on low-evidence code, unsafe type escapes, and readable structure.

Biome remains the formatter and general linter. These rules are the project's additional anti-slop policy.

Only rules listed as **active** are registered by `oxlint/anti-slop/index.ts` and enabled in `.oxlintrc.json`. The removed rules remain documented below so the audit decision is not lost.

## Active rules

| Rule | Policy |
| --- | --- |
| `no-chained-type-assertions` | Reject chained TypeScript assertions. |
| `no-known-value-widening` | Reject known values assigned to broad or anonymous types. |
| `no-object-parameters` | Reject broad `object` function parameters. |
| `no-reduce-accumulator-copy` | Reject repeated copies of growing reducer accumulators. |
| `no-runtime-typeof` | Reject runtime `typeof` checks outside type guards and existence probes. |
| `no-unknown-type-aliases` | Reject aliases that resolve to `unknown`. |
| `no-unsafe-dictionary-type` | Reject dictionary values typed as `any`, `object`, or `{}`. `unknown` is allowed. |
| `no-widen-then-assert` | Reject widening a known local value and later asserting it back to a narrower type. |
| `require-justification-comment-for-type-assertion` | Require a justification comment for non-const assertions. |
| `require-readable-spacing` | Require blank lines between logical code groups. |

## Configuration

The plugin is loaded as a local Oxlint JavaScript plugin:

```json
{
  "jsPlugins": [
    {
      "name": "anti-slop",
      "specifier": "./oxlint/anti-slop/index.ts"
    }
  ]
}
```

The active rules are configured as errors. `no-runtime-typeof` has no option: type guards are always allowed. `require-justification-comment-for-type-assertion` uses `JUSTIFICATION` by default and accepts an optional `markers` list.

## Active rule details

### `no-chained-type-assertions`

#### Behavior

Reports nested TypeScript assertions, including chains separated by parentheses:

```ts
const user = JSON.parse(text) as unknown as User;
```

```ts
const value = (<SecondType>(<FirstType>source));
```

The rule allows chains made only from `as const` assertions, although many such chains are rejected by TypeScript itself.

The diagnostic is:

```text
Do not chain type assertions. Keep the original type, or validate external input with a named type guard before using the domain type.
```

#### Resolution

Keep the value as `unknown` until a type guard validates it:

```ts
const value: unknown = JSON.parse(text);

if (!isUser(value)) {
  throw new Error('Invalid user.');
}

const user = value;
```

If an external library requires an assertion, isolate it in an adapter and explain the invariant with a `JUSTIFICATION` comment.

---

### `no-known-value-widening`

#### Behavior

Reports known values assigned to broad or anonymous target types, including:

- `unknown`
- `object`
- broad dictionaries
- anonymous object types
- selected generic containers

Examples:

```ts
const user: object = {
  name: 'Ada',
};
```

```ts
const metadata: Record<string, unknown> = {
  source: 'github',
};
```

The rule also follows stable local `const` values and checks some returns, properties, assignments, assertions, and type-guard arguments.

The diagnostic is:

```text
The explicit `{{target}}` type on {{subject}} hides information already known from the value. Let TypeScript infer the type, use `satisfies` to check a contract, or define a named type.
```

#### Resolution

Preserve inference:

```ts
const user = {
  name: 'Ada',
};
```

Use `satisfies` when a contract must be checked without replacing the inferred type:

```ts
const user = {
  name: 'Ada',
} satisfies User;
```

Use a named domain type when the explicit contract is part of the API:

```ts
type User = {
  name: string;
};

const user: User = {
  name: 'Ada',
};
```

---

### `no-object-parameters`

#### Behavior

Reports function parameters typed as the broad `object` type, including local aliases and unions containing `object`:

```ts
function process(value: object) {
  // The function has no useful property contract.
}
```

```ts
type Input = object;

function process(value: Input) {
  // Also reported.
}
```

#### Resolution

Use a named domain type:

```ts
type User = {
  name: string;
};

function process(user: User) {
  return user.name;
}
```

For unvalidated external input, use `unknown` and validate it:

```ts
function process(value: unknown) {
  if (!isUser(value)) {
    throw new Error('Invalid user.');
  }

  return value.name;
}
```

A generic utility can use a type parameter:

```ts
function freeze<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}
```

The diagnostic is:

```text
Parameter `{{parameter}}` uses the broad `object` type, which does not describe its properties. Use a named type for the expected value, or validate external input before passing it here.
```

---

### `no-reduce-accumulator-copy`

#### Behavior

Reports copies of a growing reducer accumulator inside `reduce` or `reduceRight`.

The rule checks:

- `Object.assign`
- `Array.from`
- `concat`
- `slice`
- `toSpliced`
- `toSorted`
- `toReversed`
- `with`

Example:

```ts
const result = items.reduce(
  (accumulator, item) => accumulator.concat(item),
  [],
);
```

Repeated copies can produce quadratic work and repeated allocations.

#### Resolution

Mutate a fresh local accumulator:

```ts
const result = items.reduce((accumulator, item) => {
  accumulator.push(item);
  return accumulator;
}, []);
```

For object accumulation:

```ts
const result = items.reduce((accumulator, item) => {
  accumulator[item.id] = item;
  return accumulator;
}, {});
```

A normal loop or an array transformation can also make the intent clearer:

```ts
const result = [];

for (const item of items) {
  result.push(transform(item));
}
```

If immutable copying is a deliberate contract, document that choice during review rather than adding a global exception.

---

### `no-runtime-typeof`

#### Behavior

Reports runtime `typeof` checks outside type guards:

```ts
function format(value: string | number): string {
  return typeof value === 'string'
    ? value
    : value.toFixed(2);
}
```

It also reports storing the result of `typeof`:

```ts
const kind = typeof value;
```

Existence probes against `undefined` are allowed:

```ts
if (typeof window === 'undefined') {
  return;
}
```

Type guards and assertion functions are always allowed:

```ts
function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.name === 'string'
  );
}
```

The diagnostic explains the expected resolution:

```text
Do not use `typeof` here as an inline type check. Validate the value in a named type guard. For external input, parse it at the input boundary, then use the validated domain value. `typeof` is allowed inside type guards.
```

#### Resolution

Move runtime validation into a type guard or assertion function:

```ts
function assertString(value: unknown): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error('Expected a string.');
  }
}
```

---

### `no-unknown-type-aliases`

#### Behavior

Reports aliases that resolve to `unknown`, including indirect aliases and redundant unions:

```ts
type RawValue = unknown;

type ExternalValue = RawValue;

type Input = unknown | null;
```

#### Resolution

Keep the boundary explicit:

```ts
function readPayload(): unknown {
  return getExternalPayload();
}
```

If the value has a known contract, describe that contract:

```ts
type UserPayload = {
  name: string;
  email: string;
};
```

A name such as `JsonValue = unknown` does not add static safety and is intentionally rejected.

The diagnostic is:

```text
Type alias `{{alias}}` resolves to `unknown`. Keep `unknown` visible, or define a type that describes the value instead of hiding it behind an alias.
```

---

### `no-unsafe-dictionary-type`

#### Behavior

Reports dictionary contracts whose value type is:

- `any`
- `object`
- `{}`
- an alias or union containing one of those types

Examples:

```ts
type Values = Record<string, any>;
```

```ts
type Values = {
  [key: string]: object;
};
```

```ts
type Values = Record<string, {}>;
```

`unknown` is explicitly allowed:

```ts
type Metadata = Record<string, unknown>;
```

`unknown` forces callers to validate values and is appropriate for intentionally dynamic metadata, plugin data, and raw payloads.

#### Resolution

Use a concrete value type when the domain is known:

```ts
type User = {
  name: string;
};

type UsersById = Record<string, User>;
```

Use `unknown` rather than `any` for dynamic values:

```ts
type Metadata = Record<string, unknown>;

function readSource(metadata: Metadata): string {
  const source = metadata.source;

  if (typeof source !== 'string') {
    throw new Error('Invalid source.');
  }

  return source;
}
```

There is no `allowUnknown` option. Allowing `unknown` is fixed behavior.

The diagnostic is:

```text
This dictionary uses the broad `{{value}}` value type. Replace it with a concrete value type, and validate external data before storing it.
```

---

### `no-widen-then-assert`

#### Behavior

Reports a local value that starts with precise evidence, is widened to a broad type, and is later asserted back to a narrower type:

```ts
const candidate: unknown = {
  name: 'Ada',
};

const user = candidate as User;
```

It focuses on immutable local `const` flows within the same function boundary.

#### Resolution

Preserve the inferred type:

```ts
const user = {
  name: 'Ada',
} satisfies User;
```

For external input, validate before use:

```ts
const candidate: unknown = readExternalValue();

if (!isUser(candidate)) {
  throw new Error('Invalid user.');
}

const user = candidate;
```

An assertion required by an external API belongs in a small adapter and requires a `JUSTIFICATION` comment.

The diagnostic is:

```text
Value "{{name}}" is given a broad type and later converted with a type assertion. Keep its original type, or validate external input with a named type guard before using it.
```

---

### `require-justification-comment-for-type-assertion`

#### Behavior

Requires a nearby comment for every non-const TypeScript assertion:

```ts
const user = value as User;
```

Valid example:

```ts
// JUSTIFICATION: the response guard validated every required property.
const user = value as User;
```

`as const` is excluded:

```ts
const values = ['a', 'b'] as const;
```

The default marker is `JUSTIFICATION`. The `markers` option can add or replace accepted markers:

```json
[
  "error",
  {
    "markers": ["JUSTIFICATION", "INVARIANT"]
  }
]
```

The diagnostic is:

```text
Add a `{{marker}}:` comment before this assertion or its containing statement. Explain why the value can be treated as the asserted type.
```

#### Resolution

State the reason that TypeScript cannot prove:

```ts
// JUSTIFICATION: the Node.js close event emits these values in this order.
const [exitCode, signal] = closeResult as [
  number | null,
  NodeJS.Signals | null,
];
```

A marker alone is not validation. The explanation must identify the checked condition or trusted boundary.

---

### `require-readable-spacing`

#### Behavior

Requires blank lines between logical groups:

- imports and other top-level declarations
- top-level declarations
- functions, classes, interfaces, and type aliases
- multiline variable declarations
- `return`, `if`, `switch`, `try`, and loops
- block-like statements and following statements

Example:

```ts
import { readFile } from 'node:fs/promises';

type Config = {
  path: string;
};

const config: Config = {
  path: 'config.json',
};

function loadConfig(): Config {
  return config;
}
```

Imports can stay grouped:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
```

Overload declarations can stay together:

```ts
function parse(value: string): User;
function parse(value: Buffer): User;

function parse(value: string | Buffer): User {
  // ...
}
```

#### Resolution

Add the missing blank line. Do not use a local suppression to group unrelated statements. The policy is fixed and is implemented with the vendored ESLint Stylistic padding rule.

## Audited and removed rules

The following rules were removed from the plugin and configuration. Their patterns are accepted. The examples show the former warning and the preferred resolution when the pattern is genuinely problematic.

### `no-array-filter-map`

Formerly rejected adjacent eager transformations:

```ts
const names = users
  .filter((user) => user.isActive)
  .map((user) => user.name);
```

This is readable and accepted. If a large collection makes allocation a real problem, use an iterator pipeline or a loop deliberately:

```ts
const names = [];

for (const user of users) {
  if (user.isActive) names.push(user.name);
}
```

The rule was removed because `filter` followed by `map` is often the clearest expression and alternatives are not always semantically equivalent.

### `no-conditional-empty-object-spread`

Formerly rejected conditional omission:

```ts
const request = {
  method: 'POST',
  ...(includeBody ? { body } : {}),
};
```

This is accepted. It clearly preserves the difference between an absent property and a property set to `undefined`. Use a separate statement only when it makes a particular object easier to understand:

```ts
const request = { method: 'POST' };

if (includeBody) request.body = body;
```

The rule was removed because conditional spreads do not necessarily reduce readability.

### `no-module-mocking`

Module mocks are accepted:

```ts
vi.mock('#bash-commands/github-command.ts', () => ({
  runGitHubCommand: vi.fn().mockRejectedValue(
    new Error('GitHub is unavailable'),
  ),
}));
```

Use real dependencies for integration tests when practical. Use a module mock when it is the clearest way to isolate an external failure or uncontrollable dependency. The rule was removed because a blanket ban would conflict with the project's preference to avoid dependency injection wrappers created only for tests.

### `no-reflect-apply`

`Reflect.apply` is accepted:

```ts
return Reflect.apply(method, receiver, argumentsList);
```

For ordinary calls, use a direct call:

```ts
return handler(...argumentsList);
```

Keep `Reflect.apply` when dynamic forwarding or an explicit `this` value is part of the operation. The rule was removed because `Reflect.apply` is a legitimate standard primitive.

### `no-reflect-get`

`Reflect.get` is accepted:

```ts
const value = Reflect.get(target, propertyKey, receiver);
```

Use direct access for a known property:

```ts
const name = user.name;
```

Use `Reflect.get` for dynamic keys, symbols, getters, and proxy traps. The rule was removed because a blanket ban would reject canonical proxy code.

### `no-shape-in-symbol-names`

Names containing `shape` are accepted:

```ts
type RectangleShape = {
  width: number;
  height: number;
};

function reshapePayload(payload: Payload): Payload {
  return payload;
}
```

Choose names according to the domain. The rule was removed because substring matching produced false positives such as `reshape` and `shapeless`.

### `no-unknown-parameters`

`unknown` parameters are accepted:

```ts
function parseUser(input: unknown): User {
  if (!isUser(input)) {
    throw new Error('Invalid user.');
  }

  return input;
}
```

Type-predicate parameters remain a good pattern:

```ts
function isUser(value: unknown): value is User {
  return true;
}
```

The rule was removed because a parser receives `unknown` precisely at the boundary, and a static rule could not reliably distinguish parsers from internal functions.

### `no-unknown-returns`

`unknown` return types are accepted:

```ts
function parseJson(text: string): unknown {
  return JSON.parse(text);
}
```

This is safer than allowing an unannotated parser to expose `any`. Use a named domain return type when the function actually owns validation:

```ts
function parseUser(text: string): User {
  const value: unknown = JSON.parse(text);

  if (!isUser(value)) {
    throw new Error('Invalid user.');
  }

  return value;
}
```

The rule was removed because `unknown` is a valid opaque output and the ban could encourage implicit `any`.

## Vendored spacing implementation

`require-readable-spacing` uses the vendored implementation in `vendor/eslint-stylistic/`. That directory contains the adapted `padding-line-between-statements` rule, its AST helpers, generated option types, upstream provenance, and the MIT license.

The vendored code is kept locally. It is not replaced with an npm dependency.
