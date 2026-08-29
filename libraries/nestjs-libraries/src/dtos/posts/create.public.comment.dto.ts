import { IsString, MaxLength } from 'class-validator';

export class CreatePublicCommentDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(2000)
  content: string;
}
