import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/**
 * 知识库问答请求体。
 * D3 是单轮问答：question 是本次问题，limit 控制注入 prompt 的检索片段数量。
 */
export class AskQuestionDto {
  @ApiProperty({ description: '用户问题', example: 'pgvector 为什么使用余弦距离？' })
  @IsString()
  @Length(1, 1000, { message: 'question 长度必须在 1 到 1000 之间' })
  question!: string;

  @ApiPropertyOptional({ description: '检索片段数量，默认 5', minimum: 1, maximum: 10, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  limit: number = 5;
}
