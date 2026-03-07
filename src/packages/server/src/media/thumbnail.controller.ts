import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { existsSync, createReadStream } from 'fs';
import { Public } from '../common/decorators/public.decorator.js';
import { ThumbnailService } from './thumbnail.service.js';

@Controller('media/thumbnails')
export class ThumbnailController {
  constructor(private readonly thumbnailService: ThumbnailService) {}

  @Get(':filename')
  @Public()
  getThumbnail(@Param('filename') filename: string, @Res() reply: any) {
    const filePath = this.thumbnailService.getThumbnailPath(filename);

    if (!existsSync(filePath)) {
      throw new NotFoundException('Thumbnail not found');
    }

    const stream = createReadStream(filePath);
    reply.type('image/jpeg').send(stream);
  }
}
