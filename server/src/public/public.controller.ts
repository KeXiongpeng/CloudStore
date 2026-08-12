import { Controller, Get, Post, Param, Req, Res, NotFoundException } from '@nestjs/common';
import { PublicService } from './public.service';
import { Request, Response } from 'express';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('files/:urlKey')
  async getFileMeta(@Param('urlKey') urlKey: string) {
    return this.publicService.getFileMeta(urlKey);
  }

  @Get('files/:urlKey/content')
  async getFileContent(@Param('urlKey') urlKey: string, @Res() res: Response) {
    const result = await this.publicService.getFileContent(urlKey, res);
    if (!result) {
      throw new NotFoundException('文件不存在或已删除');
    }
  }

  @Post('files/:urlKey/view')
  async recordView(@Param('urlKey') urlKey: string, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
    return this.publicService.recordView(urlKey, ip);
  }

  @Get('files/:urlKey/download')
  async download(@Param('urlKey') urlKey: string, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
    return this.publicService.getDownloadUrl(urlKey, ip);
  }
}
