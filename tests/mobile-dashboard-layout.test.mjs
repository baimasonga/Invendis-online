import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const dashboard = await read("artifacts/field-app/app/(tabs)/index.tsx");
const tabs = await read("artifacts/field-app/app/(tabs)/_layout.tsx");

test("mobile dashboard contains enlarged Android text without horizontal overflow", () => {
  assert.match(dashboard, /headerCopy:\s*\{ flex: 1, minWidth: 0/);
  assert.match(dashboard, /numberOfLines=\{2\}[\s\S]*?adjustsFontSizeToFit[\s\S]*?minimumFontScale=\{0\.75\}/);
  assert.match(dashboard, /recordDeliveryIcons:\s*\{[^}]*flexWrap: "wrap"/);
  assert.match(dashboard, /recordDeliveryIconChip:\s*\{[^}]*flexShrink: 0/);
});

test("Android bottom navigation reserves safe-area space and contains labels", () => {
  assert.match(tabs, /height: isWeb \? 84 : 56 \+ insets\.bottom/);
  assert.match(tabs, /paddingBottom: isWeb \? 34 : Math\.max\(insets\.bottom, 4\)/);
  assert.match(tabs, /tabBarAllowFontScaling: false/);
});
