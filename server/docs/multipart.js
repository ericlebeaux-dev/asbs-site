const BANNED = new Set(["ssn", "ein", "tin", "taxid", "socialsecurity", "socialsecuritynumber"]);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function banned(name) {
  return BANNED.has(String(name || "").toLowerCase().replace(/[^a-z]/g, ""));
}

function boundaryOf(contentType) {
  const match = String(contentType || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? (match[1] || match[2]).trim() : "";
}

function readLimited(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const stop = (status, message) => {
      if (settled) return;
      settled = true;
      const error = new Error(message);
      error.status = status;
      reject(error);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        req.pause();
        req.destroy();
        stop(400, "That file is too large.");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", () => stop(400, "The file could not be read."));
  });
}

function headerValue(rawHeaders, name) {
  const line = rawHeaders.split(/\r\n/).find((item) => item.toLowerCase().startsWith(`${name.toLowerCase()}:`));
  return line ? line.slice(name.length + 1).trim() : "";
}

function splitParts(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let cursor = body.indexOf(delimiter);
  if (cursor < 0) fail(400, "Upload the file as form data.");
  cursor += delimiter.length;
  while (cursor < body.length) {
    if (body[cursor] === 45 && body[cursor + 1] === 45) break;
    if (body[cursor] === 13 && body[cursor + 1] === 10) cursor += 2;
    const next = body.indexOf(delimiter, cursor);
    if (next < 0) break;
    let end = next;
    if (end >= 2 && body[end - 2] === 13 && body[end - 1] === 10) end -= 2;
    const part = body.subarray(cursor, end);
    const split = part.indexOf(Buffer.from("\r\n\r\n"));
    if (split >= 0) {
      const rawHeaders = part.subarray(0, split).toString("utf8");
      const disposition = headerValue(rawHeaders, "content-disposition");
      const nameMatch = disposition.match(/name="([^"]*)"/i) || disposition.match(/name=([^;\s]+)/i);
      const fileMatch = disposition.match(/filename="([^"]*)"/i) || disposition.match(/filename=([^;\s]+)/i);
      const type = headerValue(rawHeaders, "content-type").split(";")[0].trim().toLowerCase();
      parts.push({
        name: nameMatch ? nameMatch[1] : "",
        filename: fileMatch ? fileMatch[1] : "",
        contentType: type,
        body: part.subarray(split + 4),
      });
    }
    cursor = next + delimiter.length;
  }
  return parts;
}

export async function readUploadForm(req, maxFileBytes) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    req.resume();
    fail(400, "Upload the file as form data.");
  }
  const boundary = boundaryOf(contentType);
  if (!boundary) {
    req.resume();
    fail(400, "Upload the file as form data.");
  }
  const body = await readLimited(req, maxFileBytes + 64 * 1024);
  const parts = splitParts(body, boundary);
  const fields = {};
  let file = null;
  for (const part of parts) {
    if (!part.name) continue;
    if (banned(part.name)) fail(400, "That form could not be accepted.");
    if (part.filename) {
      if (part.name === "file") {
        file = { filename: part.filename, contentType: part.contentType, bytes: part.body };
      }
    } else {
      fields[part.name] = part.body.toString("utf8").replace(/\0/g, "").trim();
    }
  }
  if (file && file.bytes.length > maxFileBytes) fail(400, "That file is too large.");
  return { fields, file };
}
