import "server-only";
import { Auth, google, type drive_v3 } from "googleapis";
import { DefaultAzureCredential } from "@azure/identity";
import { env } from "@/lib/env";

/**
 * Read-only Google Drive access for the folder sync.
 *
 * There is no user OAuth. A household SHARES its recipe folder with the app's
 * Google service account (GOOGLE_SERVICE_ACCOUNT_EMAIL), the way you would share
 * it with a person; sharing a folder shares everything under it. The app then
 * acts as that service account:
 *
 *  - In Azure: keyless Workload Identity Federation. The container app's
 *    managed identity gets an Entra token for GOOGLE_WIF_AZURE_RESOURCE, Google
 *    STS exchanges it (pool provider GOOGLE_WIF_AUDIENCE trusts only that
 *    identity's object id), and the result impersonates the service account.
 *  - Locally (no managed identity): your gcloud Application Default
 *    Credentials impersonate the same service account, which needs
 *    `roles/iam.serviceAccountTokenCreator` for your Google user.
 *
 * No key file exists anywhere.
 */

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

// Auth classes come from googleapis' own copy of google-auth-library, so the
// client type matches what google.drive() accepts.
let _auth: Auth.BaseExternalAccountClient | Auth.OAuth2Client | undefined;

function serviceAccount(): string {
  const sa = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  if (!sa) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL is not set — Drive sync is unavailable");
  return sa;
}

async function driveAuth(): Promise<Auth.BaseExternalAccountClient | Auth.OAuth2Client> {
  if (_auth) return _auth;
  const sa = serviceAccount();

  if (env.AZURE_CLIENT_ID && env.GOOGLE_WIF_AUDIENCE && env.GOOGLE_WIF_AZURE_RESOURCE) {
    const azure = new DefaultAzureCredential({ managedIdentityClientId: env.AZURE_CLIENT_ID });
    const resource = env.GOOGLE_WIF_AZURE_RESOURCE;
    _auth = new Auth.IdentityPoolClient({
      type: "external_account",
      audience: env.GOOGLE_WIF_AUDIENCE,
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${sa}:generateAccessToken`,
      scopes: SCOPES,
      subject_token_supplier: {
        getSubjectToken: async () => {
          const t = await azure.getToken(`${resource}/.default`);
          if (!t) throw new Error("Managed identity returned no token for Google federation");
          return t.token;
        },
      },
    });
    return _auth;
  }

  const source = await new Auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  }).getClient();
  _auth = new Auth.Impersonated({
    sourceClient: source,
    targetPrincipal: sa,
    targetScopes: SCOPES,
  });
  return _auth;
}

async function drive(): Promise<drive_v3.Drive> {
  return google.drive({ version: "v3", auth: await driveAuth() });
}

/** The address households share their folder with. */
export function driveShareAddress(): string | null {
  return env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null;
}

/** Folder id from a pasted Drive link ("…/folders/<id>", "?id=<id>") or a bare id. */
export function parseFolderId(input: string): string | null {
  const s = input.trim();
  const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) ?? /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
  if (m) return m[1]!;
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

/** What the import pipeline can read. Google Docs are exported to PDF. */
export const SUPPORTED_MIME: Record<string, { ext: string; kind: "pdf" | "image" }> = {
  "application/pdf": { ext: "pdf", kind: "pdf" },
  [GOOGLE_DOC_MIME]: { ext: "pdf", kind: "pdf" },
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "image/webp": { ext: "webp", kind: "image" },
};

export class DriveAccessError extends Error {}

export async function getFolder(folderId: string): Promise<{
  id: string;
  name: string;
  ownerEmails: string[];
}> {
  const d = await drive();
  try {
    const res = await d.files.get({
      fileId: folderId,
      fields: "id, name, mimeType, owners(emailAddress)",
      supportsAllDrives: true,
    });
    if (res.data.mimeType !== FOLDER_MIME) {
      throw new DriveAccessError("That link is a file, not a folder.");
    }
    return {
      id: res.data.id!,
      name: res.data.name ?? "Drive folder",
      ownerEmails: (res.data.owners ?? [])
        .map((o) => o.emailAddress?.toLowerCase())
        .filter((e): e is string => !!e),
    };
  } catch (err) {
    if (err instanceof DriveAccessError) throw err;
    const code = (err as { code?: number }).code;
    if (code === 404 || code === 403) {
      throw new DriveAccessError(
        `The app can't see that folder yet. In Drive, share it with ${serviceAccount()} (Viewer is enough), then try again.`,
      );
    }
    throw err;
  }
}

export type DriveEntry = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  /** Subfolder path inside the shared folder, e.g. "Sweet/Cakes". "" at the root. */
  path: string;
};

const MAX_DEPTH = 10;
const MAX_FILES = 5000;

/** Every file under the folder, subfolders included (breadth-first). */
export async function listFolderTree(rootId: string): Promise<DriveEntry[]> {
  const d = await drive();
  const out: DriveEntry[] = [];
  const queue: { id: string; path: string; depth: number }[] = [{ id: rootId, path: "", depth: 0 }];
  while (queue.length > 0 && out.length < MAX_FILES) {
    const { id, path, depth } = queue.shift()!;
    let pageToken: string | undefined;
    do {
      const res = await d.files.list({
        q: `'${id}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files ?? []) {
        if (!f.id || !f.name || !f.mimeType) continue;
        if (f.mimeType === FOLDER_MIME) {
          if (depth < MAX_DEPTH) {
            queue.push({ id: f.id, path: path ? `${path}/${f.name}` : f.name, depth: depth + 1 });
          }
          continue;
        }
        out.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime ?? null,
          path,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
  }
  return out;
}

/** Download a file's bytes; a Google Doc comes back as a PDF export. */
export async function downloadFile(fileId: string, mimeType: string): Promise<Buffer> {
  const d = await drive();
  const res =
    mimeType === GOOGLE_DOC_MIME
      ? await d.files.export(
          { fileId, mimeType: "application/pdf" },
          { responseType: "arraybuffer" },
        )
      : await d.files.get(
          { fileId, alt: "media", supportsAllDrives: true },
          { responseType: "arraybuffer" },
        );
  return Buffer.from(res.data as ArrayBuffer);
}
