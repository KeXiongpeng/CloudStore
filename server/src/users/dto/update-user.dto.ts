import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsUrl({}, { message: '头像地址格式不正确' })
  avatarUrl?: string;
}
