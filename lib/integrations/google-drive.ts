import "server-only";
import { google, type drive_v3 } from "googleapis";
import { env } from "@/lib/env";

function makeOAuth2(args: { accessToken: string; refreshToken?: string }) {
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
  client.setCredentials({
    access_token: args.accessToken,
    refresh_token: args.refreshToken,
  });
  return client;
}

export const driveClient = {
  authUrl(state: string): string {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REDIRECT_URI) {
      throw new Error("Google OAuth env not configured");
    }
    const oauth2 = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI,
    );
    return oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      state,
      scope: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
      ],
    });
  },

  async exchangeCode(code: string) {
    const oauth2 = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI,
    );
    const { tokens } = await oauth2.getToken(code);
    return tokens;
  },

  async listFolders(args: { accessToken: string; refreshToken?: string }) {
    const auth = makeOAuth2(args);
    const drive = google.drive({ version: "v3", auth });
    const res = await drive.files.list({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: "files(id, name, parents)",
      pageSize: 200,
    });
    return res.data.files ?? [];
  },

  /**
   * List ALL non-trashed files in a folder (not subfolders), paginated.
   * Used for the "Scan now" bulk-import button — distinct from the changes
   * feed below which only returns deltas since the last poll.
   */
  async listAllFilesInFolder(args: {
    accessToken: string;
    refreshToken?: string;
    folderId: string;
  }): Promise<drive_v3.Schema$File[]> {
    const auth = makeOAuth2(args);
    const drive = google.drive({ version: "v3", auth });

    const out: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined;
    let safety = 20; // hard cap: 20 pages of 200 = 4000 files
    do {
      const res = await drive.files.list({
        q: `'${args.folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
        fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
        pageSize: 200,
        pageToken,
      });
      out.push(...(res.data.files ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
      safety--;
    } while (pageToken && safety > 0);

    return out;
  },

  /**
   * List files added or modified in a folder since the last poll.
   *
   * `pageToken` is the Drive Changes API cursor — passed in from the previous
   * call. On first call, we fetch a fresh start token so we only see *new*
   * activity from this point on (avoids ingesting the entire folder history).
   */
  async listNewFilesInFolder(args: {
    accessToken: string;
    refreshToken?: string;
    folderId: string;
    pageToken?: string;
  }): Promise<{ newFiles: drive_v3.Schema$File[]; nextPageToken: string }> {
    const auth = makeOAuth2(args);
    const drive = google.drive({ version: "v3", auth });

    let pageToken = args.pageToken;
    if (!pageToken) {
      const start = await drive.changes.getStartPageToken();
      pageToken = start.data.startPageToken!;
      // First poll: also do a one-shot listing so existing files in the folder
      // are not lost. (Subsequent polls will use the changes feed.)
      const initial = await drive.files.list({
        q: `'${args.folderId}' in parents and trashed = false`,
        fields: "files(id, name, mimeType, parents, modifiedTime)",
        pageSize: 100,
      });
      return { newFiles: initial.data.files ?? [], nextPageToken: pageToken };
    }

    const newFiles: drive_v3.Schema$File[] = [];
    let cursor: string | undefined = pageToken;
    let nextPageToken = pageToken;

    while (cursor) {
      const res: { data: drive_v3.Schema$ChangeList } = await drive.changes.list({
        pageToken: cursor,
        fields:
          "newStartPageToken, nextPageToken, changes(file(id, name, mimeType, parents, modifiedTime), removed)",
        pageSize: 100,
        includeRemoved: false,
      });

      for (const change of res.data.changes ?? []) {
        const file = change.file;
        if (!file || !file.parents) continue;
        if (!file.parents.includes(args.folderId)) continue;
        newFiles.push(file);
      }

      if (res.data.nextPageToken) {
        cursor = res.data.nextPageToken;
      } else {
        nextPageToken = res.data.newStartPageToken ?? cursor;
        cursor = undefined;
      }
    }

    return { newFiles, nextPageToken };
  },

  async downloadFile(args: {
    accessToken: string;
    refreshToken?: string;
    fileId: string;
    mimeType: string;
  }): Promise<Buffer> {
    const auth = makeOAuth2(args);
    const drive = google.drive({ version: "v3", auth });

    if (args.mimeType === "application/vnd.google-apps.document") {
      // Export Google Docs as PDF for the vision pipeline
      const res = await drive.files.export(
        { fileId: args.fileId, mimeType: "application/pdf" },
        { responseType: "arraybuffer" },
      );
      return Buffer.from(res.data as ArrayBuffer);
    }

    const res = await drive.files.get(
      { fileId: args.fileId, alt: "media" },
      { responseType: "arraybuffer" },
    );
    return Buffer.from(res.data as ArrayBuffer);
  },
};
