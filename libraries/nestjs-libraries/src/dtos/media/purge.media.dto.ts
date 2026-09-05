import { IsArray, IsOptional, IsUUID } from 'class-validator';

export class PurgeMediaDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  mediaIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  folderIds?: string[];
}
