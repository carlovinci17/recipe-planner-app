import "server-only";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { env } from "@/lib/env";

/**
 * Azure Blob Storage seam (Module 5 / ADR-0006). Keyless: `DefaultAzureCredential`
 * resolves to the Container App's Managed Identity in prod and your `az login`
 * identity in dev — never an account key. The account has shared-key access
 * disabled, so this is the only way in.
 *
 * Reads are server-mediated (no SAS): callers `download` a Buffer or `stream` the
 * blob and pipe it (Lesson 5.3's image route + next/image). Container names mirror
 * the Supabase buckets (`recipe-uploads`, `recipe-images`).
 */

// One credential + service client per process (the SDK caches tokens internally).
let service: BlobServiceClient | undefined;
function serviceClient(): BlobServiceClient {
  if (!service) {
    const account = env.AZURE_STORAGE_ACCOUNT;
    if (!account) throw new Error("lib/storage/blob imported but AZURE_STORAGE_ACCOUNT is not set.");
    service = new BlobServiceClient(
      `https://${account}.blob.core.windows.net`,
      new DefaultAzureCredential(),
    );
  }
  return service;
}

function blob(container: string, path: string) {
  return serviceClient().getContainerClient(container).getBlockBlobClient(path);
}

export const blobStorage = {
  async download(container: string, path: string): Promise<Buffer> {
    return blob(container, path).downloadToBuffer();
  },

  async upload(args: {
    container: string;
    path: string;
    buffer: Buffer;
    contentType: string;
  }): Promise<string> {
    await blob(args.container, args.path).uploadData(args.buffer, {
      blobHTTPHeaders: { blobContentType: args.contentType },
    });
    return args.path;
  },

  /** Stream a blob for the image route to pipe to the response (no bytes buffered). */
  async stream(
    container: string,
    path: string,
  ): Promise<{
    body: NodeJS.ReadableStream;
    contentType?: string;
    contentLength?: number;
  }> {
    const resp = await blob(container, path).download();
    if (!resp.readableStreamBody) throw new Error(`Blob has no body: ${container}/${path}`);
    return {
      body: resp.readableStreamBody,
      contentType: resp.contentType,
      contentLength: resp.contentLength,
    };
  },

  async exists(container: string, path: string): Promise<boolean> {
    return blob(container, path).exists();
  },

  async remove(container: string, path: string): Promise<void> {
    await blob(container, path).deleteIfExists();
  },
};
