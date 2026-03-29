/** Resize image in-browser for avatar upload (JPEG output). */
export async function fileToAvatarBlob(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file");
  }
  const bmp = await createImageBitmap(file);
  try {
    const max = 512;
    const w = bmp.width;
    const h = bmp.height;
    const scale = Math.min(1, max / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process image in this browser");
    ctx.drawImage(bmp, 0, 0, cw, ch);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), "image/jpeg", 0.88);
    });
  } finally {
    bmp.close();
  }
}
