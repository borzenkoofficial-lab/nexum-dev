import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReactElement } from "react";
import { KvardMark } from "./KvardMark.ts";

type MarkProps = {
  viewBox: string;
  width: number;
  height: number;
  role?: string;
  "aria-label"?: string;
  "aria-hidden"?: boolean;
  children: ReactElement[];
};

function propsOf(mark: ReactElement): MarkProps {
  return mark.props as MarkProps;
}

test("renders the canonical KVARD mark geometry at the requested size", () => {
  const props = propsOf(KvardMark({ size: 24 }));
  const [background, glyph] = props.children;

  assert.equal(props.viewBox, "0 0 64 64");
  assert.equal(props.width, 24);
  assert.equal(props.height, 24);
  assert.equal(background.type, "rect");
  assert.equal(background.props.rx, 15);
  assert.equal(background.props.fill, "var(--kv-brand-ink, #24213A)");
  assert.equal(glyph.type, "path");
  assert.equal(glyph.props.d, "M19 14v36M22 32l24-18M24 31l22 19");
  assert.equal(glyph.props.stroke, "var(--kv-on-brand, #FFFFFF)");
  assert.equal(glyph.props.strokeWidth, 6.5);
  assert.equal(glyph.props.strokeLinecap, "round");
  assert.equal(glyph.props.strokeLinejoin, "round");
});

test("uses a 32px default size and supports the 16px app-icon scale", () => {
  const defaultProps = propsOf(KvardMark({}));
  const compactProps = propsOf(KvardMark({ size: 16 }));

  assert.equal(defaultProps.width, 32);
  assert.equal(defaultProps.height, 32);
  assert.equal(compactProps.width, 16);
  assert.equal(compactProps.height, 16);
});

test("hides decorative marks from assistive technology", () => {
  const props = propsOf(KvardMark({}));
  assert.equal(props["aria-hidden"], true);
  assert.equal(props.role, undefined);
  assert.equal(props["aria-label"], undefined);
});

test("exposes a supplied accessible label", () => {
  const props = propsOf(KvardMark({ label: "КВАРД" }));
  assert.equal(props.role, "img");
  assert.equal(props["aria-label"], "КВАРД");
  assert.equal(props["aria-hidden"], undefined);
});
