import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GET_EXPIRES_SECONDS, SSE_ALGORITHM } from "./settings.js";

export function encryptedPutInput({ bucket, key, body, contentType }) {
  return {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ServerSideEncryption: SSE_ALGORITHM,
  };
}

export function createS3DocStore(settings) {
  const client = new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: {
      accessKeyId: settings.keyId,
      secretAccessKey: settings.secret,
    },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumCalculation: "WHEN_REQUIRED",
  });
  const Bucket = settings.bucket;

  async function streamToBuffer(body) {
    if (!body) return Buffer.alloc(0);
    if (Buffer.isBuffer(body)) return body;
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  return {
    async putBytes(key, bytes, contentType) {
      await client.send(new PutObjectCommand(encryptedPutInput({
        bucket: Bucket,
        key,
        body: bytes,
        contentType,
      })));
    },
    async putJson(key, value) {
      await this.putBytes(key, Buffer.from(JSON.stringify(value)), "application/json");
    },
    async getJson(key) {
      const bytes = await this.getBytes(key);
      if (!bytes) return null;
      return JSON.parse(bytes.toString("utf8"));
    },
    async head(key) {
      try {
        const result = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: Number(result.ContentLength || 0), contentType: result.ContentType || "" };
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") return null;
        throw error;
      }
    },
    async getRange(key, start, end) {
      const result = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=${start}-${end}` }));
      return streamToBuffer(result.Body);
    },
    async getBytes(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket, Key: key }));
        return streamToBuffer(result.Body);
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey") return null;
        throw error;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async presignGet({ key }) {
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: GET_EXPIRES_SECONDS });
      return { url, expiresIn: GET_EXPIRES_SECONDS };
    },
  };
}
