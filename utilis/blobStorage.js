// Azure Blob Storage for E2EE media.
//
// The server never uploads or downloads file bytes itself: it hands the client a
// short-lived SAS URL and the device talks to Blob Storage directly. Every blob is
// ciphertext (encrypted on the device with a per-file key that only travels inside
// the E2EE message body), so neither this server nor Azure can view the media.
//
// Env:
//   AZURE_STORAGE_CONNECTION_STRING  storage account connection string (secret)
//   AZURE_MEDIA_CONTAINER            private container name (default "media")
// If the connection string is missing, media is disabled (routes return 503)
// instead of crashing the server — same approach as the Firebase init.
const {
  BlobServiceClient,
  BlobSASPermissions,
} = require("@azure/storage-blob");

const SAS_TTL_MS = 10 * 60 * 1000; // 10 minutes
// Allow for clock skew between this server and Azure.
const SAS_START_SKEW_MS = 5 * 60 * 1000;

let containerClient = null;

const init = () => {
  const conn = (process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim();
  const containerName = (process.env.AZURE_MEDIA_CONTAINER || "").trim();
  if (!conn) {
    console.warn(
      "Azure Blob Storage not configured (AZURE_STORAGE_CONNECTION_STRING unset). Media messages are disabled."
    );
    return;
  }
  try {
    containerClient =
      BlobServiceClient.fromConnectionString(conn).getContainerClient(containerName);
    console.log(`Azure Blob Storage ready (container "${containerName}")`);
  } catch (error) {
    containerClient = null;
    console.warn(`Azure Blob Storage init failed: ${error.message}. Media messages are disabled.`);
  }
};

const isEnabled = () => !!containerClient;

const sasWindow = () => ({
  startsOn: new Date(Date.now() - SAS_START_SKEW_MS),
  expiresOn: new Date(Date.now() + SAS_TTL_MS),
});

// Write-only URL for one blob name ("c" create + "w" write). Can't read or list.
const getUploadUrl = (blobName) =>
  containerClient.getBlockBlobClient(blobName).generateSasUrl({
    permissions: BlobSASPermissions.parse("cw"),
    ...sasWindow(),
  });

// Read-only URL for one blob.
const getReadUrl = (blobName) =>
  containerClient.getBlockBlobClient(blobName).generateSasUrl({
    permissions: BlobSASPermissions.parse("r"),
    ...sasWindow(),
  });

// Uploaded size in bytes, or null if the blob doesn't exist (never uploaded).
const getBlobSize = async (blobName) => {
  try {
    const props = await containerClient.getBlockBlobClient(blobName).getProperties();
    return props.contentLength ?? 0;
  } catch (error) {
    if (error.statusCode === 404) return null;
    throw error;
  }
};

const deleteBlob = async (blobName) => {
  await containerClient.getBlockBlobClient(blobName).deleteIfExists();
};

module.exports = { init, isEnabled, getUploadUrl, getReadUrl, getBlobSize, deleteBlob };
