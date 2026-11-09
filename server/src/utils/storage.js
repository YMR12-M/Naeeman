/**
 * تخزين الصور (صور القصّات) على قرص السيرفر.
 *
 *  • الملف بيتسمّى باسم عشوائي (UUID) جوّه فولدر المحل، فمفيش اسم من
 *    المستخدم يدخل في المسار.
 *  • النوع بيتعرف من أوّل بايتات الملف نفسه (JPEG / PNG / WebP)، مش من
 *    الترويسة اللي ممكن تتزوّر.
 *  • الفولدر برّه أي مكان عام: الصورة بتتقري من مسار بيتحقّق من الصلاحية.
 */
import crypto from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { ApiError } from './ApiError.js';

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** النوع الحقيقي من البايتات، أو null */
export function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}

const photosDir = (shopId) => path.join(env.uploadsDir, 'photos', String(Number(shopId)));

/** يحفظ صورة ويرجّع { file_name, mime, bytes } */
export async function savePhoto(shopId, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw ApiError.unprocessable('ابعت الصورة نفسها (JPEG أو PNG أو WebP)', { code: 'PHOTO_REQUIRED' });
  }
  if (buffer.length > MAX_PHOTO_BYTES) throw ApiError.payloadTooLarge('الصورة أكبر من 3 ميجا', { code: 'PHOTO_TOO_LARGE' });
  const type = sniffImage(buffer);
  if (!type) throw ApiError.unprocessable('الملف ده مش صورة (المسموح JPEG وPNG وWebP)', { code: 'PHOTO_TYPE' });

  const dir = photosDir(shopId);
  await mkdir(dir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${type.ext}`;
  await writeFile(path.join(dir, fileName), buffer, { flag: 'wx' });
  return { file_name: fileName, mime: type.mime, bytes: buffer.length };
}

function resolvePhoto(shopId, fileName) {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(fileName)) throw ApiError.notFound('الصورة غير موجودة', { code: 'PHOTO_NOT_FOUND' });
  return path.join(photosDir(shopId), fileName);
}

export async function readPhoto(shopId, fileName) {
  try {
    return await readFile(resolvePhoto(shopId, fileName));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.notFound('ملف الصورة مش موجود على السيرفر', { code: 'PHOTO_FILE_MISSING' });
  }
}

export async function removePhoto(shopId, fileName) {
  await rm(resolvePhoto(shopId, fileName), { force: true });
}
