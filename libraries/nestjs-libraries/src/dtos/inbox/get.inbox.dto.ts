import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class GetInboxDto {
  @IsOptional()
  @Transform(({ value }) => (value !== undefined ? Number(value) : 0))
  page?: number;

  @IsOptional()
  @Transform(({ value }) => (value !== undefined ? Number(value) : 20))
  limit?: number;

  @IsOptional()
  @IsIn(['COMMENT', 'MENTION', 'DM'])
  type?: 'COMMENT' | 'MENTION' | 'DM';

  @IsOptional()
  @IsString()
  integrationId?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unreadOnly?: boolean;
}
