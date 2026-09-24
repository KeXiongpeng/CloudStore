import { IsNotEmpty, IsString, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class MultipartPartDto {
  @IsNumber()
  partNumber!: number;

  @IsString()
  etag!: string;
}

export class CompleteMultipartDto {
  @IsNotEmpty()
  @IsString()
  uploadId!: string;

  @IsNotEmpty()
  @IsString()
  filename!: string;

  @IsNotEmpty()
  @IsString()
  contentType!: string;

  @IsNotEmpty()
  @IsNumber()
  totalSize!: number;

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MultipartPartDto)
  parts!: MultipartPartDto[];
}
