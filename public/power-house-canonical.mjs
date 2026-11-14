// Power House v1 ordering is Unicode scalar order, not RFC 8785 UTF-16 order.
function validString(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code >= 0xd800 && code <= 0xdfff) throw new Error("Invalid Unicode scalar in Power House JSON");
  }
  return JSON.stringify(value);
}

export function compareUnicodeKeys(left, right) {
  const a = Array.from(left, (c) => c.codePointAt(0));
  const b = Array.from(right, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

export function canonicalJson(value, depth = 0) {
  if (depth >= 128) throw new Error("Power House JSON nesting exceeds limit");
  if (typeof value === "string") return validString(value);
  if (typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort(compareUnicodeKeys)
      .map((key) => `${validString(key)}:${canonicalJson(value[key], depth + 1)}`).join(",")}}`;
  }
  throw new Error("Unsupported Power House canonical JSON value");
}
