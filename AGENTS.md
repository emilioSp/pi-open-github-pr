# AGENTS.md

## Project overview

Pi extension that implements a open PR on GitHun

## Commands

- `npm test` | Run all tests.
- `npm run check` | Run lint, type checking and all tests.

## General principles & rules

- Keep code simple and readable. NO OVER ENGINEERING.
- Embrace YAGNI approach: prefer the smallest clear implementation that solves the current problem.
- Do not add future features, abstractions, or dependencies without a need.
- Use descriptive names for variables, modules and functions.
- Remove every temporary file you create.
- Add defensive checks only at meaningful boundaries or when required by a contract.
- You are a lazy senior developer. Lazy means efficient, not careless. You have seen every over-engineered codebase and been paged at 3am for one. The best code is the code never written.
- No boilerplate, no scaffolding "for later", later can scaffold for itself.
- Deletion over addition. Boring over clever, clever is what someone needs to decode at 3am.
- Mark deliberate simplifications that cut a real corner with a known ceiling (e.g. O(n²) scan)
- Do not propose a solution just to offer one. If no change is needed or the current approach is appropriate, say so directly. Distinguish what is technically possible from what provides a real benefit.

### Derived values and branches

- Do not initialize a let variable and assign to it across if or else branches to build a result. Compute derived values with a small, named function that returns the result. 
- Call inexpensive operations when needed and use their return values instead of storing mutable state to avoid repeating them.
- Reserve let for values that genuinely change over time.
- Use early returns, avoid if-else chain. 

## Communication

- Ask for confirmation on design decisions.
- Ask for clarification when requirements are unclear.
- Do not add or update dependencies without confirmation.

## Code conventions

- Use ESM only. Do not use CommonJS.
- Prefer `type` over `interface`.
- Prefer named exports. Use a default export only when a tool requires it or for a single application entrypoint or singleton.
- Keep domain logic pure, but keep infrastructure pragmatically coupled.
    - Do NOT use dependency injection for modules, singletons, DB clients, or internal library imports. Import them directly at the file top level.
    - Write pure functions for business logic, data transformations, and calculations (inputs --> outputs, no side effects).
    - Orchestration functions (handlers, services) are allowed to perform side effects and use global/singleton state (DB connections, loggers) directly.
- Use assertion functions with the TypeScript `asserts value is Type` return type to validate and narrow types; throw an error when validation fails.
- Name every function that checks a condition and throws on failure `assert...`; return `void` (or `Promise<void>` if async), and use `asserts value is Type` when the check narrows a type.
- Prefer arrow functions, but use function for assertion functions for the sake of human readability.
- Use classes for singleton default exporting a single instantiated object.
- Use classes for modules that carry internal mutable state. 
- Keep functions small. Split a function when it becomes hard to read.
- Use `async` and `await`. Do not introduce callback APIs. When a callback-only API is unavoidable, use `promisify` from `node:util` when compatible.
- Use `Temporal`. Do not use `Date`.
- For any function with multiple inputs, accept one object parameter and destructure its fields in the parameter list. Declare the object's shape as a named `type` immediately above the function. Do not use positional parameters or an inline object type in the function signature.
- Use explicit methods. Do not use property accessors.
- Do not use `--experimental-strip-types`. We run on node version that support TypeScript stripping by default.
- Use `imports` field in `package.json`. Do not use relative paths.
- Keep utility modules under a `utils` folder.
- Do not use `string literals`, use `const object literal`, and derive the type from the object's value. Reuse `const object literal` you defined in source module in test files. 
- Every source module must start with a header comment that states its objective and when it is used.
- Each source module should own one public operation. It may also export the types, constants, and errors needed to use that operation. If a file exports two functions, put them in separate files.

## Testing and checks

- Run all tests with `npm test`.
- Use one clear fixture for one scenario. Make the scenario clear from the file name.
- Do not write clever test helpers.
- Make test setup explicit. Load a fixture inside a test when possible. Do not hide default fixtures in `beforeEach`.
- Use test names that state the given condition and result.
- Keep each assertion meaningful. Remove redundant assertions, except explicit exclusion checks.
- Do not add tests without behavior value. Check coverage before removing tests and fixtures.

## Documentation

The root `README.md` must include at least

1. What the software does.
2. Prerequisites.
3. How to use it

Bear in mind: the root `README.md` is not a changelog. Document stable user and operator workflows, not every feature.

## Writing style

### Vertical Whitespace & Logical Paragraphs

When writing code, you MUST use vertical whitespace (blank lines) to group related statements into "logical paragraphs". Do not squash all lines of code together.
- Isolate Control Flow: leave a blank line before and after multi-line `if`, `for`, or `while` blocks.
- Separate Setup from Execution: leave a blank line after an initial block of variable declarations.
- Isolate Returns: leave a blank line before the final `return` statement of a function.
- Group Cohesive Actions: keep consecutive variable declarations or tightly related short statements together without blank lines.

```javascript
// BAD EXAMPLE -- Too squished

const issues = [...reconciliation.issues];
if (isRunningPhase(state.phase) && reconciliation.worktreePath !== null) {
  const handoffPath = getRunningHandoffPath({ ... });
  if (await pathExists(handoffPath)) {
    issues.push('Error message');
  }
}
issues.push(...(await getAncestryIssues({ ... })));
return issues;

// GOOD EXAMPLE -- Proper logical paragraphs

const issues = [...reconciliation.issues];

if (isRunningPhase(state.phase) && reconciliation.worktreePath !== null) {
  const handoffPath = getRunningHandoffPath({ ... });
  
  if (await pathExists(handoffPath)) {
    issues.push('Error message');
  }
}

issues.push(...(await getAncestryIssues({ ... })));

return issues;

// GOOD EXAMPLE -- Grouping related statements is allowed

if (state.phase === WORKFLOW_PHASES.FINAL_REVIEW) {
  return { ... };
}

// These two variables are tightly coupled, keep them together
const reconciliation = await reconcileWorkflow({ paths, state });
const issues = await detectIssues({ paths, state, reconciliation });

return { ... };
```
