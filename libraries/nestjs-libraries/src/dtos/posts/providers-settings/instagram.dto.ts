import { Type } from 'class-transformer';
import {
  IsArray,
  IsDefined,
  IsIn,
  IsNumber,
  IsString,
  Max,
  Min,
  ValidateNested,
  IsOptional,
} from 'class-validator';

export class Collaborators {
  @IsDefined()
  @IsString()
  label: string;
}

export class InstagramAudio {
  @IsDefined()
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  artist?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  audio_volume?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  video_volume?: number;
}
export class InstagramDto {
  // 'feed' / 'reel' / 'story' are the explicit choices the composer offers
  // (R1). 'post' stays permanently valid as a legacy alias for posts queued
  // before this ships (KTD4) - it is never rewritten in stored data, and is
  // normalized to feed/reel by media-type detection at read time in the
  // provider (InstagramProvider.postPending), not here.
  @IsIn(['feed', 'reel', 'story', 'post'])
  @IsDefined()
  post_type: 'feed' | 'reel' | 'story' | 'post';

  @IsOptional()
  is_trial_reel?: boolean;

  @IsIn(['MANUAL', 'SS_PERFORMANCE'])
  @IsOptional()
  graduation_strategy?: 'MANUAL' | 'SS_PERFORMANCE';

  @Type(() => Collaborators)
  @ValidateNested({ each: true })
  @IsArray()
  @IsOptional()
  collaborators: Collaborators[];

  @Type(() => InstagramAudio)
  @ValidateNested()
  @IsOptional()
  audio?: InstagramAudio;

  // Reel-only (R8): whether the Reel also appears in the Feed/Reels tab.
  // No default is asserted here - InstagramProvider.postPending decides the
  // default (documented there) when this is left unset.
  @IsOptional()
  share_to_feed?: boolean;

  // Reel-only (R9): custom Reel cover image, sent instead of thumb_offset.
  @IsOptional()
  @IsString()
  cover_url?: string;

  // Read by InstagramProvider.deriveCompanionPosts (U4) to decide whether a
  // Feed/Reel post should also generate a linked Story companion post.
  @IsOptional()
  also_share_to_story?: boolean;

  // Which carousel slide (by Media.id) becomes the Story companion when the
  // post has more than one media item. Read by deriveCompanionPosts; falls
  // back to the first slide when unset or when the id no longer resolves.
  @IsOptional()
  @IsString()
  story_media_id?: string;
}
