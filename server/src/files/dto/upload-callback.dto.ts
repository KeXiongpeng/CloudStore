import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class UploadCallbackDto {
  @IsNotEmpty()
  @IsString()
  filename!: string;

  @IsNotEmpty()
  @IsString()
  contentType!: string;

  @IsNotEmpty()
  @IsNumber()
  fileSize!: number;

  @IsNotEmpty()
  @IsString()
  storageKey!: string;

  @IsOptional()
  @IsString()
  urlKey?: string;
}
