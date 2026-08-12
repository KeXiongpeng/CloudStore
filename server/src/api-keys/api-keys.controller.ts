import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IsNotEmpty, IsString } from 'class-validator';

class CreateApiKeyDto {
  @IsNotEmpty()
  @IsString()
  name: string;
}

@Controller('keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.createApiKey(userId, dto.name);
  }

  @Get()
  async list(@CurrentUser('id') userId: string) {
    return this.apiKeysService.listApiKeys(userId);
  }

  @Delete(':id')
  async delete(
    @CurrentUser('id') userId: string,
    @Param('id') keyId: string,
  ) {
    return this.apiKeysService.deleteApiKey(userId, keyId);
  }
}
