import { IsString, MinLength } from 'class-validator';

export class ReplyInboxDto {
  @IsString()
  @MinLength(1)
  message: string;
}
