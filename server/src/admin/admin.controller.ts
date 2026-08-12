import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../common/guards/admin-role.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { IsOptional, IsEnum } from 'class-validator';
import { Role, Tier } from '@prisma/client';

class UpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(Tier)
  tier?: Tier;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  getUsers(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
  ) {
    return this.adminService.getUsers(page, limit);
  }

  @Patch('users/:id')
  updateUser(@Param('id') userId: string, @Body() dto: UpdateUserDto) {
    return this.adminService.updateUser(userId, dto.role, dto.tier);
  }

  @Delete('users/:id')
  disableUser(@Param('id') userId: string) {
    return this.adminService.disableUser(userId);
  }

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }
}
