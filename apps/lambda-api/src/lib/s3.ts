import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getConfig } from './config.js';
import { Readable } from 'node:stream';

let _client: S3Client | undefined;

function client(): S3Client {
  if (!_client) {
    _client = new S3Client({ region: getConfig().AWS_REGION });
  }
  return _client;
}

const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export interface PresignedUpload {
  upload_url: string;
  upload_key: string;
  expires_at: string;
}

export async function presignUpload(
  contentType: string,
  filename: string
): Promise<PresignedUpload> {
  const cfg = getConfig();
  const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 200);
  const key = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;

  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: cfg.S3_UPLOADS_BUCKET,
      Key: key,
      ContentType: contentType
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS }
  );

  return {
    upload_url: url,
    upload_key: key,
    expires_at: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString()
  };
}

export async function downloadUpload(key: string): Promise<{ buffer: Buffer; contentType: string }> {
  const cfg = getConfig();
  const res = await client().send(
    new GetObjectCommand({ Bucket: cfg.S3_UPLOADS_BUCKET, Key: key })
  );
  if (!res.Body) throw new Error(`Empty S3 object: ${key}`);
  const buffer = await streamToBuffer(res.Body as Readable);
  return {
    buffer,
    contentType: res.ContentType ?? 'application/octet-stream'
  };
}

export async function uploadPackshot(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const cfg = getConfig();
  await client().send(
    new PutObjectCommand({
      Bucket: cfg.S3_PACKSHOTS_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType
    })
  );
  // Return a 24h presigned GET URL — packshots bucket is private.
  const url = await getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: cfg.S3_PACKSHOTS_BUCKET, Key: key }),
    { expiresIn: 24 * 60 * 60 }
  );
  return url;
}

async function streamToBuffer(stream: Readable | ReadableStream): Promise<Buffer> {
  if (stream instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  // Web ReadableStream fallback (newer SDKs may return this)
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/** Test-only escape hatch. */
export function _resetS3Client(): void {
  _client = undefined;
}
