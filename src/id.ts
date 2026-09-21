import { stripVTControlCharacters } from "node:util";

import type { NodeKind, TraceNode } from "./model.js";

const SEPARATOR = "/";

/** Control code points are not portable across Moura's serialization boundaries. */
const UNICODE_CONTROL = /\p{Cc}/u;
/** Characters that can alter terminal or logical display structure. */
const UNSAFE_DISPLAY_CHARACTER = /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/u;
const UNSAFE_DISPLAY_CHARACTER_GLOBAL =
  /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu;

export type LocalId = string;
export type CanonicalId = string;

export class InvalidLocalIdError extends Error {
  constructor(localId: string, reason: string) {
    super(`Invalid local ID ${JSON.stringify(localId)}: ${reason}`);
    this.name = "InvalidLocalIdError";
  }
}

/**
 * Applies the invariant shared by every node kind. Naming patterns remain a
 * configuration concern so the core is not coupled to REQ/SCN/CASE prefixes.
 */
export function localId(value: string): LocalId {
  if (value.length === 0) {
    throw new InvalidLocalIdError(value, "must not be empty");
  }
  if (value.includes(SEPARATOR)) {
    throw new InvalidLocalIdError(
      value,
      `must not contain reserved separator '${SEPARATOR}'`,
    );
  }
  if (/\p{White_Space}/u.test(value)) {
    throw new InvalidLocalIdError(value, "must not contain whitespace");
  }
  const unsafeReason = interoperableStringError(value);
  if (unsafeReason) throw new InvalidLocalIdError(value, unsafeReason);
  return value;
}

/**
 * Returns why a Moura identifier-like string cannot safely cross its supported
 * UTF-8, YAML, Markdown, HTML, and tooling boundaries.
 */
export function interoperableStringError(value: string): string | undefined {
  if (UNICODE_CONTROL.test(value))
    return "must not contain Unicode control characters (General_Category=Cc)";
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) index += 1;
      else return "must not contain unpaired UTF-16 surrogates";
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return "must not contain unpaired UTF-16 surrogates";
    }
  }
  return undefined;
}

/** Make untrusted text safe for a single diagnostic/display boundary. */
export function safeDisplayString(value: string): string {
  const withoutTerminalControls = stripVTControlCharacters(value);
  if (
    interoperableStringError(withoutTerminalControls) === undefined &&
    !UNSAFE_DISPLAY_CHARACTER.test(withoutTerminalControls)
  )
    return withoutTerminalControls;
  return JSON.stringify(withoutTerminalControls).replace(
    UNSAFE_DISPLAY_CHARACTER_GLOBAL,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Validate an external canonical Case ID without constructing domain nodes. */
export function canonicalCaseIdError(value: string): string | undefined {
  const segments = value.split(SEPARATOR);
  if (segments.length !== 3)
    return "must contain exactly three local IDs separated by '/'";
  try {
    for (const segment of segments) localId(segment);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

/** The single construction point for logical canonical IDs. */
export function canonicalId(nodes: readonly TraceNode[]): CanonicalId {
  if (nodes.length === 0) {
    throw new Error("A canonical ID requires at least one node");
  }

  assertHierarchy(nodes.map((node) => node.kind));
  return nodes.map((node) => localId(node.localId)).join(SEPARATOR);
}

function assertHierarchy(kinds: readonly NodeKind[]): void {
  const hierarchy: readonly NodeKind[] = ["requirement", "scenario", "case"];
  if (
    kinds.length > hierarchy.length ||
    kinds.some((kind, index) => kind !== hierarchy[index])
  ) {
    throw new Error(`Invalid node hierarchy: ${kinds.join(" -> ")}`);
  }
}
