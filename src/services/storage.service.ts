import { BUCKETS } from "@/lib/constants";
import { hasSupabaseConfig, supabase } from "@/services/supabase";

export type UploadProgressCallback = (progress: number) => void;

export const uploadFile = async (
  bucket: (typeof BUCKETS)[number],
  path: string,
  file: File,
  onProgress?: UploadProgressCallback,
): Promise<string> => {
  if (!hasSupabaseConfig) {
    onProgress?.(100);
    return URL.createObjectURL(file);
  }

  onProgress?.(5);
  let progress = 5;
  const timer = window.setInterval(() => {
    progress = Math.min(progress + 8, 90);
    onProgress?.(progress);
  }, 180);

  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  window.clearInterval(timer);
  if (error) throw error;
  onProgress?.(100);
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
};

export const getStoragePathFromPublicUrl = (
  bucket: (typeof BUCKETS)[number],
  publicUrl: string | null | undefined,
): string | null => {
  if (!publicUrl) return null;

  const marker = `/storage/v1/object/public/${bucket}/`;
  const index = publicUrl.indexOf(marker);
  if (index < 0) return null;

  const rawPath = publicUrl.slice(index + marker.length);
  const cleanPath = rawPath.split("?")[0];
  return cleanPath || null;
};

export const removeFileByPublicUrl = async (
  bucket: (typeof BUCKETS)[number],
  publicUrl: string | null | undefined,
): Promise<void> => {
  if (!hasSupabaseConfig) return;

  const path = getStoragePathFromPublicUrl(bucket, publicUrl);
  if (!path) return;

  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
};
