export function createMemoryDocStore() {
  const objects = new Map();
  return {
    async putBytes(key, bytes, contentType, options = {}) {
      objects.set(key, {
        bytes: Buffer.from(bytes),
        contentType: contentType || "application/octet-stream",
        encryption: options.encryption || "",
      });
    },
    async putJson(key, value) {
      await this.putBytes(key, Buffer.from(JSON.stringify(value)), "application/json");
    },
    async getJson(key) {
      const item = objects.get(key);
      if (!item) return null;
      return JSON.parse(item.bytes.toString("utf8"));
    },
    async head(key) {
      const item = objects.get(key);
      if (!item) return null;
      return { size: item.bytes.length, contentType: item.contentType, encryption: item.encryption || "" };
    },
    async getRange(key, start, end) {
      const item = objects.get(key);
      if (!item) return null;
      return item.bytes.subarray(start, end + 1);
    },
    async getBytes(key) {
      const item = objects.get(key);
      return item ? item.bytes : null;
    },
    async delete(key) {
      objects.delete(key);
    },
    async presignGet({ key }) {
      return { url: `https://storage.example/get/${encodeURIComponent(key)}`, expiresIn: 60 };
    },
  };
}
