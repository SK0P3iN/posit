import { IsBoolean } from 'class-validator';

export class LikeInboxCommentDto {
  @IsBoolean()
  liked: boolean;
}
