import { IsNotEmpty, IsNumber, IsString, Max } from 'class-validator';

export class PresignUploadDto {
  @IsNotEmpty()
  @IsString()
  filename!: string;

  @IsNotEmpty()
  @IsString()
  contentType!: string;

  @IsNotEmpty()
  @IsNumber()
  @Max(5242880, { message: '文件大小超过 5MB 限制，请使用分片上传' })
  fileSize!: number;
}
