import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * 可溯源检索请求体。
 * query 是必填的自然语言问题；limit 限制返回最相似的 chunk 数量。
 */
export class SearchDocumentsDto {
  @ApiProperty({ description: '用户提问或搜索语句', example: 'pgvector 为什么用余弦距离' })
  @IsString()
  @Length(1, 1000, { message: 'query 长度必须在 1 到 1000 之间' })
  query!: string;

  @ApiPropertyOptional({ description: '返回条数，默认 5', minimum: 1, maximum: 20, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
