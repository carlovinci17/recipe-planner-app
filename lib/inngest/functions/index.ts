export { processUpload } from "./process-upload";
export { processUrl } from "./process-url";
export { tagRecipeFn } from "./tag-recipe";
export { driveFolderPoller } from "./drive-poller";
export { processDriveFile } from "./process-drive-file";
export { sweepStuckIngestionJobs } from "./sweep-stuck-jobs";

import { processUpload } from "./process-upload";
import { processUrl } from "./process-url";
import { tagRecipeFn } from "./tag-recipe";
import { driveFolderPoller } from "./drive-poller";
import { processDriveFile } from "./process-drive-file";
import { sweepStuckIngestionJobs } from "./sweep-stuck-jobs";

export const allInngestFunctions = [
  processUpload,
  processUrl,
  tagRecipeFn,
  driveFolderPoller,
  processDriveFile,
  sweepStuckIngestionJobs,
];
