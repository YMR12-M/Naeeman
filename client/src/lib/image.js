/**
 * تصغير الصورة على الجهاز قبل ما تترفع: صورة موبايل 4 ميجا بتبقى حوالي
 * 150 كيلو (JPEG، أطول ضلع 1280 بكسل)، فالرفع سريع على نت المحل
 * والسيرفر ما يتملاش.
 */
export async function shrinkImage(file, { max = 1280, quality = 0.82 } = {}) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    source = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('الملف ده مش صورة'));
      image.src = URL.createObjectURL(file);
    });
  }
  const width = source.width || source.naturalWidth;
  const height = source.height || source.naturalHeight;
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  const blob = await new Promise((resolve) => { canvas.toBlob(resolve, 'image/jpeg', quality); });
  if (!blob) throw new Error('الصورة ما اتصغّرتش — جرّب صورة تانية');
  return blob;
}
