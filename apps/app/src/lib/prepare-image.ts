export async function prepareInvoiceImage(file: File): Promise<Blob> {
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (context === null)
      throw new Error(
        'This browser cannot process images. Turn off background removal to upload the original.',
      );
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const red = pixels.data[index] ?? 0,
        green = pixels.data[index + 1] ?? 0,
        blue = pixels.data[index + 2] ?? 0;
      const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
      const alpha = pixels.data[index + 3] ?? 0;
      pixels.data[index + 3] = Math.round(
        alpha * Math.max(0, Math.min(1, (190 - luminance) / 100)),
      );
      pixels.data[index] = 0;
      pixels.data[index + 1] = 0;
      pixels.data[index + 2] = 0;
    }
    context.putImageData(pixels, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null) reject(new Error('Could not prepare a PNG image.'));
        else resolve(blob);
      }, 'image/png');
    });
  } finally {
    image.close();
  }
}
