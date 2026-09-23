import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUploadSessionDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  mimeType!: string;

  @IsNumber()
  @Min(1)
  size!: number;

  @IsOptional()
  @IsString()
  @Length(64, 64)
  hash?: string;

  @IsOptional()
  @IsIn(['sha256'])
  hashAlgorithm?: string = 'sha256';

  @IsOptional()
  @IsUUID()
  folderId?: string;

  @IsOptional()
  @IsString()
  clientUploadId?: string;

  @IsOptional()
  @IsInt()
  @Min(5242880)
  @Max(16777216)
  chunkSize?: number;
}

export class CompleteSessionDto {
  @IsOptional()
  @IsString()
  @Length(64, 64)
  hash?: string;

  @IsOptional()
  parts?: { partNumber: number; etag: string }[];
}
