import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

function isRuntimeFunction(node: ESTree.Node): node is RuntimeFunction {
	return (
		node.type === "ArrowFunctionExpression" ||
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression"
	);
}

function isInsideTypeGuard(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;

	while (current !== null && current.type !== "Program") {
		if (isRuntimeFunction(current)) {
			return current.returnType?.typeAnnotation.type === "TSTypePredicate";
		}

		current = current.parent;
	}

	return false;
}

/** Return whether typeof safely probes for the existence of a possibly absent binding. */
function isExistenceProbe(node: ESTree.UnaryExpression): boolean {
	const parent = node.parent;

	if (parent.type !== "BinaryExpression") return false;

	if (!["===", "!==", "==", "!="].includes(parent.operator)) return false;
	const other = parent.left === node ? parent.right : parent.left;

	return other.type === "Literal" && other.value === "undefined";
}

/** Disallow runtime typeof checks that narrow unparsed values instead of decoding them. */
export const noRuntimeTypeofRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.",
		},
		messages: {
			runtimeTypeof:
				"Do not use `typeof` here as an inline type check. Validate the value in a named type guard. For external input, parse it at the input boundary, then use the validated domain value. `typeof` is allowed inside type guards.",
		},
	},
	createOnce(context) {
		return {
			UnaryExpression(node) {
				if (
					node.operator === "typeof" &&
					!isExistenceProbe(node) &&
					!isInsideTypeGuard(node)
				) {
					context.report({ node, messageId: "runtimeTypeof" });
				}
			},
		};
	},
});
