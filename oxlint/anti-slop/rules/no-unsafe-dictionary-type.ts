import { defineRule } from "@oxlint/plugins";

import {
	classifyUnsafeDictionary,
	classifyUnsafeDictionaryValue,
	createTypeEnvironment,
	type TypeEnvironment,
} from "../utils/dictionary-types.ts";
import { visibleTypeAlias } from "../utils/type-alias-resolution.ts";

import type { ESTree } from "@oxlint/plugins";

const typeNodeKinds: ReadonlySet<string> = new Set([
	"JSDocNonNullableType",
	"JSDocNullableType",
	"JSDocUnknownType",
	"TSAnyKeyword",
	"TSArrayType",
	"TSBigIntKeyword",
	"TSBooleanKeyword",
	"TSConditionalType",
	"TSConstructorType",
	"TSFunctionType",
	"TSImportType",
	"TSIndexedAccessType",
	"TSInferType",
	"TSIntersectionType",
	"TSIntrinsicKeyword",
	"TSLiteralType",
	"TSMappedType",
	"TSNamedTupleMember",
	"TSNeverKeyword",
	"TSNullKeyword",
	"TSNumberKeyword",
	"TSObjectKeyword",
	"TSParenthesizedType",
	"TSStringKeyword",
	"TSSymbolKeyword",
	"TSTemplateLiteralType",
	"TSThisType",
	"TSTupleType",
	"TSTypeLiteral",
	"TSTypeOperator",
	"TSTypePredicate",
	"TSTypeQuery",
	"TSTypeReference",
	"TSUndefinedKeyword",
	"TSUnionType",
	"TSUnknownKeyword",
	"TSVoidKeyword",
]);

function isTypeNode(node: ESTree.Node): node is ESTree.TSType {
	return typeNodeKinds.has(node.type);
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
	return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function isInsideTypeAliasDeclaration(node: ESTree.Node): boolean {
	let current: ESTree.Node | null = node.parent;

	while (current !== null && current.type !== "Program") {
		if (current.type === "TSTypeAliasDeclaration") return true;
		current = current.parent;
	}

	return false;
}

function isPlainAliasConsumerUse(node: ESTree.TSType, environment: TypeEnvironment): boolean {
	if (node.type !== "TSTypeReference" || node.typeArguments?.params.length) return false;
	const name = typeReferenceName(node);

	return (
		name !== null &&
		visibleTypeAlias(name, node, environment.typeAliases) !== null &&
		!isInsideTypeAliasDeclaration(node)
	);
}

const DICTIONARY_CLASSIFICATION_OPTIONS = { allowUnknown: true } as const;

function isInsideTypeParameterConstraint(node: ESTree.TSType): boolean {
	let child: ESTree.Node = node;
	let parent: ESTree.Node | null = child.parent;

	while (parent !== null && parent.type !== "Program") {
		if (parent.type === "TSTypeParameter" && parent.constraint === child) return true;
		child = parent;
		parent = child.parent;
	}

	return false;
}

function shouldReportType(node: ESTree.TSType, environment: TypeEnvironment): boolean {
	if (isInsideTypeParameterConstraint(node)) return false;

	if (isPlainAliasConsumerUse(node, environment)) return false;

	if (
		classifyUnsafeDictionary(
			node,
			environment,
			DICTIONARY_CLASSIFICATION_OPTIONS,
		) === null
	)
		return false;
	let current: ESTree.Node | null = node.parent;

	while (current !== null && current.type !== "Program") {
		if (
			isTypeNode(current) &&
			classifyUnsafeDictionary(
				current,
				environment,
				DICTIONARY_CLASSIFICATION_OPTIONS,
			) !== null
		)
			return false;
		current = current.parent;
	}

	return true;
}

/** Disallow object-dictionary contracts whose direct value type is an unsafe escape hatch. */
export const noUnsafeDictionaryTypeRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow object-dictionary contracts whose direct value type is any, object, {}, or a union/alias containing one of those escape hatches.",
		},
		messages: {
			unsafeDictionary:
				"This dictionary uses the broad `{{value}}` value type. Replace it with a concrete value type, and validate external data before storing it.",
		},
	},
	createOnce(context) {
		let environment: TypeEnvironment | null = null;

		const report = (node: ESTree.Node, value: string) => {
			context.report({ node, messageId: "unsafeDictionary", data: { value } });
		};

		const reportIfUnsafe = (node: ESTree.TSType) => {
			if (environment === null || !shouldReportType(node, environment)) return;

			const unsafe = classifyUnsafeDictionary(
				node,
				environment,
				DICTIONARY_CLASSIFICATION_OPTIONS,
			);

			if (unsafe === null) return;
			report(node, unsafe.unsafeValue);
		};

		return {
			Program(node) {
				environment = createTypeEnvironment(
					node,
					context.sourceCode.visitorKeys,
				);
			},
			TSTypeReference: reportIfUnsafe,
			TSTypeLiteral: reportIfUnsafe,
			TSMappedType: reportIfUnsafe,
			TSIndexSignature(node) {
				if (
					environment === null ||
					node.typeAnnotation === null ||
					node.parent.type === "TSTypeLiteral"
				)
					return;

				const unsafe = classifyUnsafeDictionaryValue(
					node.typeAnnotation.typeAnnotation,
					environment,
					DICTIONARY_CLASSIFICATION_OPTIONS,
				);

				if (unsafe !== null) report(node, unsafe.unsafeValue);
			},
		};
	},
});
