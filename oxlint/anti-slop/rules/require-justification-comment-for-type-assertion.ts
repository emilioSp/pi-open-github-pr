import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

const DEFAULT_JUSTIFICATION_MARKERS = ["JUSTIFICATION"] as const;

const commentOwnerKinds = new Set([
  "ExpressionStatement",
  "PropertyDefinition",
  "ReturnStatement",
  "ThrowStatement",
  "VariableDeclaration",
]);

function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

function configuredJustificationMarkers(option: unknown): readonly string[] {
  if (typeof option !== "object" || option === null || !("markers" in option)) {
    return DEFAULT_JUSTIFICATION_MARKERS;
  }

  const configured = option.markers;

  if (!Array.isArray(configured)) return DEFAULT_JUSTIFICATION_MARKERS;

  const markers = configured.flatMap((marker) =>
    typeof marker === "string" && marker.trim().length > 0 ? [marker.trim()] : [],
  );

  return markers.length > 0 ? markers : DEFAULT_JUSTIFICATION_MARKERS;
}

function markerPattern(markers: readonly string[]): RegExp {
  const alternation = markers
    .map((marker) => marker.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
    .join("|");

  return new RegExp(
    String.raw`(?:^|[^\p{L}\p{N}_])(?:${alternation})\s*:\s*\S`,
    "u",
  );
}

function hasJustificationBefore(
  sourceCode: SourceCode,
  owner: ESTree.Node,
  assertion: TypeAssertion,
  pattern: RegExp,
): boolean {
  return sourceCode
    .getCommentsBefore(owner)
    .some(
      (comment) => comment.end <= assertion.start && pattern.test(comment.value),
    );
}

function hasJustificationComment(
  sourceCode: SourceCode,
  node: TypeAssertion,
  pattern: RegExp,
): boolean {
  let current: ESTree.Node = node;

  while (true) {
    if (hasJustificationBefore(sourceCode, current, node, pattern)) return true;

    if (commentOwnerKinds.has(current.type)) {
      const exportDeclaration = current.parent;

      return (
        exportDeclaration.type === "ExportNamedDeclaration" &&
        exportDeclaration.declaration === current &&
        hasJustificationBefore(sourceCode, exportDeclaration, node, pattern)
      );
    }

    if (current.parent.type === "Program") return false;
    current = current.parent;
  }
}

/** Require every non-const type assertion to state the invariant TypeScript cannot express. */
export const requireJustificationCommentForTypeAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a nearby JUSTIFICATION comment for every TypeScript type assertion except const assertions.",
    },
    messages: {
      missingJustificationComment:
        "Add a `{{marker}}:` comment before this assertion or its containing statement. Explain why the value can be treated as the asserted type.",
    },
    schema: [
      {
        type: "object",
        properties: {
          markers: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ markers: ["JUSTIFICATION"] }],
  },
  createOnce(context) {
    const patterns = new Map<string, RegExp>();

    const checkAssertion = (node: TypeAssertion) => {
      if (isConstAssertion(node)) return;
      const markers = configuredJustificationMarkers(context.options?.[0]);
      const patternKey = markers.join("\u0000");
      const pattern = patterns.get(patternKey) ?? markerPattern(markers);
      patterns.set(patternKey, pattern);

      if (hasJustificationComment(context.sourceCode, node, pattern)) return;
      context.report({
        node,
        messageId: "missingJustificationComment",
        data: { marker: markers[0] ?? DEFAULT_JUSTIFICATION_MARKERS[0] },
      });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
