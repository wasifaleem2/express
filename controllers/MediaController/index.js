const MessageDto = require("../../dtos/messageDto");
const blobStorage = require("../../utilis/blobStorage");
const {
  MAX_ATTACHMENTS,
  MEDIA_MAX_BYTES,
  newBlobName,
  normalizeNames,
  readableMedia,
} = require("../../utilis/media");

const disabled = (res) =>
  res.status(503).json(new MessageDto(503, "Media storage is not configured."));

// GET /media/limits -> { maxFileBytes, maxAttachments }
// The size limit lives only in the server env (MEDIA_MAX_BYTES); the app reads
// it from here to warn before uploading.
const getLimits = (req, res) =>
  res.status(200).json(
    new MessageDto(200, "Media limits.", {
      maxFileBytes: MEDIA_MAX_BYTES,
      maxAttachments: MAX_ATTACHMENTS,
    })
  );

// POST /media/upload-urls { count } -> { uploads: [{ name, uploadUrl }] }
// Short-lived write-only SAS URLs; the device PUTs the encrypted files straight
// to Blob Storage, then sends the message with `images` or `documents: [name, ...]`.
const createUploadUrls = async (req, res) => {
  if (!blobStorage.isEnabled()) return disabled(res);
  const count = Number(req.body?.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_ATTACHMENTS) {
    return res
      .status(400)
      .json(new MessageDto(400, `count must be between 1 and ${MAX_ATTACHMENTS}.`));
  }
  try {
    const uploads = await Promise.all(
      Array.from({ length: count }, async () => {
        const name = newBlobName(req.user.phone);
        return { name, uploadUrl: await blobStorage.getUploadUrl(name) };
      })
    );
    return res.status(200).json(new MessageDto(200, "Upload URLs issued.", { uploads }));
  } catch (error) {
    console.error("[media] upload-urls failed:", error.message);
    return res.status(500).json(new MessageDto(500, "Server Error."));
  }
};

// POST /media/read-urls { names } -> { urls: { name: url } }
// Short-lived read-only SAS URLs, only for files the caller may see. Names the
// caller can't read are simply left out.
const createReadUrls = async (req, res) => {
  if (!blobStorage.isEnabled()) return disabled(res);
  const names = normalizeNames(req.body?.names);
  if (!names) {
    return res.status(400).json(new MessageDto(400, "names must be an array of file names."));
  }
  try {
    const readable = await readableMedia(names, req.user.phone);
    const urls = {};
    for (const name of readable) {
      urls[name] = await blobStorage.getReadUrl(name);
    }
    return res.status(200).json(new MessageDto(200, "Read URLs issued.", { urls }));
  } catch (error) {
    console.error("[media] read-urls failed:", error.message);
    return res.status(500).json(new MessageDto(500, "Server Error."));
  }
};

module.exports = { getLimits, createUploadUrls, createReadUrls };
