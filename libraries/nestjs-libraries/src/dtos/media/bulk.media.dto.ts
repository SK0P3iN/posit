import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class MediaIdsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  ids: string[];
}

export class BulkDeleteMediaDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  ids: string[];

  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

export class RestoreMediaDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  mediaIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  folderIds?: string[];
}

export class DeleteFolderDto {
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
