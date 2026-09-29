import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  DocumentsService,
  type IngestResult,
  type TraceableSearchResult,
} from './documents.service';
import { IngestResultDto, TraceableSearchResultDto } from './dto/document-api.dto';
import { SearchDocumentsDto } from './dto/search-documents.dto';

/** 学习阶段先限制为 5MB，避免一次性把大文件送进 embedding API。 */
const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024;

/**
 * 文档 HTTP 入口：
 * D2 只有 CLI，D3 Step 1 先把“上传导入”和“可溯源检索”暴露给前端/Swagger。
 */
@ApiTags('documents')
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /**
   * 上传 Markdown 并导入知识库。
   * 文件保存在内存缓冲区：学习项目数据量小，不需要临时磁盘文件；
   * sourcePath 由服务层统一生成为 uploads/<安全文件名>，保证同名重复上传仍然幂等。
   */
  @Post('import')
  @ApiOperation({ summary: '上传 Markdown 文件并导入文档库' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Markdown 文件，扩展名必须是 .md' },
      },
    },
  })
  @ApiOkResponse({ type: IngestResultDto, description: '导入或跳过结果' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_IMPORT_FILE_SIZE },
      fileFilter: (_request, file, callback) => {
        if (!file.originalname.toLowerCase().endsWith('.md')) {
          callback(new BadRequestException('只支持上传 .md 文件'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  async importDocument(@UploadedFile() file?: Express.Multer.File): Promise<IngestResult> {
    // fileFilter 已拦截非 .md；这里再检查一次，方便单元测试并在缺少文件时返回明确错误。
    if (!file) {
      throw new BadRequestException('请上传要导入的 .md 文件');
    }
    if (!file.originalname.toLowerCase().endsWith('.md')) {
      throw new BadRequestException('只支持上传 .md 文件');
    }

    // Buffer 按 UTF-8 解码；本项目学习素材主要是 Markdown，服务层再统一算 sha256。
    return await this.documentsService.ingestUpload(
      file.originalname,
      file.buffer.toString('utf8'),
    );
  }

  /** 语义检索：问题向量化后返回最相似 chunk，并携带标题、路径、headingPath 等溯源字段。 */
  @Post('search')
  @ApiOperation({ summary: '按语义检索文档 chunk，返回可溯源结果' })
  @ApiOkResponse({
    type: [TraceableSearchResultDto],
    description: '按相似度排序的文档片段',
  })
  search(@Body() dto: SearchDocumentsDto): Promise<TraceableSearchResult[]> {
    // DTO 的 limit 可选；Controller 明确给默认值，避免 Service 隐藏“默认返回几条”的约定。
    return this.documentsService.search(dto.query, dto.limit ?? 5);
  }
}
