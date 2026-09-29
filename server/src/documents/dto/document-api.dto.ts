import { ApiProperty } from '@nestjs/swagger';

/**
 * Swagger 文档里展示的导入结果。
 * imported = 新建或重建；skipped = contentHash 没变，直接复用旧数据。
 */
export class IngestResultDto {
  @ApiProperty({ enum: ['imported', 'skipped'], description: '导入是否真正重建' })
  status!: 'imported' | 'skipped';

  @ApiProperty({ description: '文档 ID', example: '8f2b...-...' })
  documentId!: string;

  @ApiProperty({ description: '文档包含的 chunk 数量', example: 12 })
  chunkCount!: number;
}

/**
 * Swagger 文档里展示的可溯源检索结果。
 * headingPath/sourcePath/chunkIndex 一起定位原文位置，供后续 RAG 引用使用。
 */
export class TraceableSearchResultDto {
  @ApiProperty({ description: 'chunk ID' })
  chunkId!: string;

  @ApiProperty({ description: '所属文档 ID' })
  documentId!: string;

  @ApiProperty({ description: '文档标题' })
  title!: string;

  @ApiProperty({ description: '来源路径；上传文件是 uploads/<安全文件名>' })
  sourcePath!: string;

  @ApiProperty({
    type: [String],
    description: 'Markdown 标题路径',
    example: ['D2 交接文档', '3. 数据模型'],
  })
  headingPath!: string[];

  @ApiProperty({ description: 'chunk 在文档内的序号，从 0 开始' })
  chunkIndex!: number;

  @ApiProperty({ description: '命中的原文片段' })
  content!: string;

  @ApiProperty({ description: '余弦相似度，越大越相似' })
  similarity!: number;
}
