import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class FolderOrderDto {
  @IsUUID('4')
  id: string;

  @IsInt()
  order: number;
}

export class ReorderFoldersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => FolderOrderDto)
  orders: FolderOrderDto[];
}
