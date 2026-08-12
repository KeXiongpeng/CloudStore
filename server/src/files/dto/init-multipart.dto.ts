import { IsNotEmpty, IsString, IsNumber } from 'class-validator';

export class InitMultipartDto {
  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsString()
  contentType: string;

  @IsNotEmpty()
  @IsNumber()
  totalSize: number;
}
