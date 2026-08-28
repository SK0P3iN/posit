import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FacebookDto } from './facebook.dto';

describe('FacebookDto (U4/U5 - also_share_to_story, story_media_id)', () => {
  describe('also_share_to_story', () => {
    it('is valid when absent', async () => {
      const dto = plainToInstance(FacebookDto, {});
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'also_share_to_story')).toHaveLength(0);
    });

    it('is valid when a boolean', async () => {
      const dto = plainToInstance(FacebookDto, { also_share_to_story: true });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'also_share_to_story')).toHaveLength(0);
    });
  });

  describe('story_media_id', () => {
    it('is valid when absent', async () => {
      const dto = plainToInstance(FacebookDto, {});
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'story_media_id')).toHaveLength(0);
    });

    it('is valid when a string', async () => {
      const dto = plainToInstance(FacebookDto, { story_media_id: 'media-123' });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'story_media_id')).toHaveLength(0);
    });

    it('rejects a non-string value', async () => {
      const dto = plainToInstance(FacebookDto, { story_media_id: 12345 });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'story_media_id')).toBe(true);
    });
  });
});
