import { IsNotEmpty } from 'class-validator';

export class RefreshTokenDto {
  @IsNotEmpty({ message: 'refresh_token 不能为空' })
  refresh_token!: string;
}
