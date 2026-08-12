export async function resolveAttachmentUrl(attachment, services) {
  const attachmentPath = String(attachment?.attachmentPath || "").trim();

  if (attachmentPath) {
    return services.getDownloadURL(
      services.storageRef(services.storage, attachmentPath)
    );
  }

  return String(attachment?.attachmentUrl || "").trim();
}

export async function openAttachment(attachment, services) {
  const attachmentPath = String(attachment?.attachmentPath || "").trim();

  if (!attachmentPath) {
    const fallbackUrl = String(attachment?.attachmentUrl || "").trim();
    if (!fallbackUrl) throw new Error("This attachment has no available file reference.");
    services.openWindow(fallbackUrl, "_blank", "noopener");
    return fallbackUrl;
  }

  const pendingWindow = services.openWindow("about:blank", "_blank");
  if (pendingWindow) pendingWindow.opener = null;

  try {
    const url = await resolveAttachmentUrl(attachment, services);
    if (pendingWindow) {
      pendingWindow.location.replace(url);
    } else {
      services.openWindow(url, "_blank", "noopener");
    }
    return url;
  } catch (error) {
    pendingWindow?.close();
    throw error;
  }
}
