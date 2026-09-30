import { eslintCompatPlugin } from "@oxlint/plugins";

import { noReduceAccumulatorCopyRule } from "./rules/no-reduce-accumulator-copy.ts";
import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";
import { requireReadableSpacingRule } from "./rules/require-readable-spacing.ts";
import { requireJustificationCommentForTypeAssertionRule } from "./rules/require-justification-comment-for-type-assertion.ts";

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const antiSlopPlugin = eslintCompatPlugin({
	meta: { name: "anti-slop" },
	rules: {
		"no-reduce-accumulator-copy": noReduceAccumulatorCopyRule,
		"no-chained-type-assertions": noChainedTypeAssertionsRule,
		"no-known-value-widening": noKnownValueWideningRule,
		"no-object-parameters": noObjectParametersRule,
		"no-runtime-typeof": noRuntimeTypeofRule,
		"no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
		"no-unknown-type-aliases": noUnknownTypeAliasesRule,
		"no-widen-then-assert": noWidenThenAssertRule,
		"require-readable-spacing": requireReadableSpacingRule,
		"require-justification-comment-for-type-assertion": requireJustificationCommentForTypeAssertionRule,
	},
});

export default antiSlopPlugin;
