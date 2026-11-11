const TYPES = {
  "application/pdf": { ext: "pdf", magic: Buffer.from("%PDF") },
  "image/png": { ext: "png", magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  "image/jpeg": { ext: "jpg", magic: Buffer.from([0xff, 0xd8, 0xff]) },
};

export function fileRule(contentType) {
  return TYPES[String(contentType || "").toLowerCase()] || null;
}

export function extensionFor(contentType) {
  return fileRule(contentType)?.ext || "";
}

export function magicMatches(contentType, bytes) {
  const rule = fileRule(contentType);
  if (!rule || !bytes) return false;
  const sample = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (sample.length < rule.magic.length) return false;
  return sample.subarray(0, rule.magic.length).equals(rule.magic);
}

export function safeOriginalName(name) {
  const base = String(name || "upload").split(/[/\\]/).pop().replace(/[^\w.\- ]+/g, "").trim();
  return (base || "upload").slice(0, 120);
}
