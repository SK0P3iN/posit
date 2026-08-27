import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateMediaFolderDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;
}
