import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiAdminAuth, ApiConflict, ApiNotFound, ApiValidationError } from '../../common/swagger/api-responses';
import { AuthenticatedAdmin } from '../auth/interfaces/authenticated-admin.interface';
import { CleanupMediaQueryDto, ListMediaQueryDto, MediaResponseDto } from './dto/media.dto';
import { MediaService } from './media.service';

export const mediaExample = {
  id: '01928c1e-0000-7000-8000-00000000aaaa',
  originalFilename: 'mountain.jpg',
  original: { url: 'https://cdn.example.com/media/2026/01/1f0c.../original.jpg', width: 1440, height: 3200, size: 1840000, mimeType: 'image/jpeg' },
  preview: { url: 'https://cdn.example.com/media/2026/01/1f0c.../preview.webp', width: 922, height: 2048, size: 310000, mimeType: 'image/webp' },
  thumbnail: { url: 'https://cdn.example.com/media/2026/01/1f0c.../thumbnail.webp', width: 216, height: 480, size: 21000, mimeType: 'image/webp' },
  usage: { wallpapers: 1, categories: 0, banners: 0 },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const singleFileBody = {
  schema: {
    type: 'object',
    required: ['file'],
    properties: { file: { type: 'string', format: 'binary', description: 'JPEG, PNG or WebP image' } },
  },
};

@ApiTags('Admin / Media')
@ApiAdminAuth()
@Controller('admin/media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload a single image',
    description:
      'Multipart field `file`. The content is decoded and validated (real format must match the declared type), auto-oriented and stripped of metadata. Generates an original, a WebP preview and a WebP thumbnail.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(singleFileBody)
  @ApiCreatedResponse({ type: MediaResponseDto, schema: { example: { data: mediaExample } } })
  @ApiValidationError()
  @ApiUnsupportedMediaTypeResponse({ description: 'Not a JPEG/PNG/WebP image or content/type mismatch' })
  @ApiPayloadTooLargeResponse({ description: 'File exceeds MEDIA_MAX_FILE_SIZE_MB' })
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ): Promise<MediaResponseDto> {
    if (!file) throw new BadRequestException('A file must be provided in the "file" field');
    return this.media.upload(file, admin, meta);
  }

  @Post('bulk')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FilesInterceptor('files'))
  @ApiOperation({
    summary: 'Upload multiple images',
    description: 'Multipart field `files` (repeatable, max MEDIA_MAX_FILES_PER_UPLOAD). Each file is processed independently; the response reports per-file success or error.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } },
    },
  })
  @ApiOkResponse({
    schema: {
      example: {
        data: {
          succeeded: 1,
          failed: 1,
          results: [
            { index: 0, filename: 'a.jpg', status: 'success', item: mediaExample },
            { index: 1, filename: 'notes.txt', status: 'error', error: { statusCode: 415, message: 'Only JPEG, PNG and WebP images are allowed' } },
          ],
        },
      },
    },
  })
  @ApiPayloadTooLargeResponse({ description: 'A file exceeds the size limit or too many files' })
  uploadMany(
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @ReqMeta() meta: RequestMeta,
  ) {
    if (!files || files.length === 0) throw new BadRequestException('At least one file must be provided in the "files" field');
    return this.media.uploadMany(files, admin, meta);
  }

  @Get()
  @ApiOperation({ summary: 'List uploaded media (originals with derivatives and usage counts)' })
  @ApiOkResponse({ schema: { example: { data: [mediaExample], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } } } })
  @ApiValidationError()
  list(@Query() query: ListMediaQueryDto) {
    return this.media.list(query);
  }

  @Post('cleanup')
  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove orphaned storage objects (SUPER_ADMIN)',
    description: 'Finds stored objects with no database record (older than 1 hour). Defaults to a dry run; pass dryRun=false to delete.',
  })
  @ApiOkResponse({
    schema: { example: { data: { dryRun: true, scannedObjects: 300, orphanedObjects: 2, deletedObjects: 0, orphanedKeys: ['media/2026/01/x/original.jpg'] } } },
  })
  cleanup(@Query() query: CleanupMediaQueryDto, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta) {
    return this.media.cleanupOrphans(query.dryRun, admin, meta);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get media metadata' })
  @ApiOkResponse({ type: MediaResponseDto, schema: { example: { data: mediaExample } } })
  @ApiNotFound('Media')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.media.get(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete unused media', description: 'Fails with 409 if referenced by any wallpaper, category or banner.' })
  @ApiNoContentResponse()
  @ApiNotFound('Media')
  @ApiConflict('Media is in use and cannot be deleted')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: AuthenticatedAdmin, @ReqMeta() meta: RequestMeta): Promise<void> {
    await this.media.remove(id, admin, meta);
  }
}
