import { IsArray, IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class MoveMediaDto {
  @IsArray()
  @IsUUID('4', { each: true })
  ids: string[];

  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  folderId?: string | null;
}
