import { Controller, Post, UseInterceptors, UploadedFiles, BadRequestException } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Throttle } from '@nestjs/throttler';
import { imageExtension } from './image-validation';
import { UPLOAD_DIRECTORY } from './upload-path';

@Controller('upload')
export class UploadController {
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseInterceptors(FilesInterceptor('images', 5, {
    storage: memoryStorage(),
    fileFilter: (_req, file, cb) => {
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) {
        return cb(new BadRequestException('Solo se permiten imágenes JPEG, PNG, GIF o WebP'), false);
      }
      cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024, files: 5, fields: 0, parts: 5 },
  }))
  async uploadFiles(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files?.length) throw new BadRequestException('Archivos no proveídos');
    const extensions = files.map((file) => imageExtension(file.buffer, file.mimetype));
    if (extensions.some((extension) => !extension)) {
      throw new BadRequestException('Uno o más archivos no contienen una imagen válida');
    }
    await mkdir(UPLOAD_DIRECTORY, { recursive: true });
    const filenames: string[] = [];
    try {
      for (let index = 0; index < files.length; index++) {
        const filename = `images-${randomUUID()}${extensions[index]}`;
        await writeFile(join(UPLOAD_DIRECTORY, filename), files[index].buffer, { flag: 'wx' });
        filenames.push(filename);
      }
    } catch (error) {
      await Promise.allSettled(filenames.map((filename) => unlink(join(UPLOAD_DIRECTORY, filename))));
      throw error;
    }
    return { message: 'Archivos subidos correctamente', urls: filenames.map((filename) => `/uploads/${filename}`) };
  }
}
