type CropShape = "square" | "banner";

type CropOptions = {
  shape: CropShape;
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
};

const readImageElement = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("No se pudo procesar la imagen."));
    };

    image.src = objectUrl;
  });

const toBlob = (canvas: HTMLCanvasElement, fileType: string, quality: number): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("No se pudo exportar la imagen."));
      },
      fileType,
      quality,
    );
  });

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const cropImageFile = async (file: File, options: CropOptions): Promise<File> => {
  return cropImageFileWithTransform(file, options);
};

export const cropImageFileWithTransform = async (file: File, options: CropOptions): Promise<File> => {
  const image = await readImageElement(file);
  const quality = options.quality ?? 0.92;
  const zoom = clamp(options.zoom ?? 1, 1, 3);
  const offsetXPct = clamp(options.offsetX ?? 0, -100, 100) / 100;
  const offsetYPct = clamp(options.offsetY ?? 0, -100, 100) / 100;
  const sourceRatio = image.width / image.height;
  const targetRatio = options.shape === "square" ? 1 : 3;

  let baseCropWidth = image.width;
  let baseCropHeight = image.height;

  if (sourceRatio > targetRatio) {
    baseCropWidth = Math.floor(image.height * targetRatio);
  } else if (sourceRatio < targetRatio) {
    baseCropHeight = Math.floor(image.width / targetRatio);
  }

  const cropWidth = clamp(Math.floor(baseCropWidth / zoom), 1, image.width);
  const cropHeight = clamp(Math.floor(baseCropHeight / zoom), 1, image.height);
  const centerX = image.width / 2 + ((image.width - cropWidth) / 2) * offsetXPct;
  const centerY = image.height / 2 + ((image.height - cropHeight) / 2) * offsetYPct;
  const offsetX = clamp(Math.floor(centerX - cropWidth / 2), 0, image.width - cropWidth);
  const offsetY = clamp(Math.floor(centerY - cropHeight / 2), 0, image.height - cropHeight);

  const maxWidth = options.maxWidth ?? (options.shape === "square" ? 512 : 1600);
  const maxHeight = options.maxHeight ?? (options.shape === "square" ? 512 : 533);

  const scale = Math.min(maxWidth / cropWidth, maxHeight / cropHeight, 1);
  const outWidth = Math.max(1, Math.floor(cropWidth * scale));
  const outHeight = Math.max(1, Math.floor(cropHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo inicializar el recorte de imagen.");

  ctx.drawImage(image, offsetX, offsetY, cropWidth, cropHeight, 0, 0, outWidth, outHeight);

  const fileType = file.type.startsWith("image/") ? file.type : "image/jpeg";
  const blob = await toBlob(canvas, fileType, quality).catch(() => toBlob(canvas, "image/jpeg", quality));
  const extension = blob.type.includes("png")
    ? "png"
    : blob.type.includes("webp")
      ? "webp"
      : blob.type.includes("jpg") || blob.type.includes("jpeg")
        ? "jpg"
        : "jpg";
  const baseName = file.name.replace(/\.[^.]+$/, "");

  return new File([blob], `${baseName}.${extension}`, {
    type: blob.type,
    lastModified: Date.now(),
  });
};
