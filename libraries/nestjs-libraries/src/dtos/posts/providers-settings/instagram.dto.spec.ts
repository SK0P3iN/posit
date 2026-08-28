import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InstagramDto } from './instagram.dto';

// First DTO validation test in this repo (U5). Uses class-validator's
// validate() against a class-transformer plainToInstance() instance, the
// same pattern InstagramDto itself is built on (see its own decorator
// imports) rather than inventing a different test approach.
describe('InstagramDto (U5 - post_type restructure, share_to_feed, cover_url)', () => {
  const basePayload = {
    post_type: 'feed',
  };

  it.each(['feed', 'reel', 'story', 'post'])(
    'accepts post_type %s',
    async (post_type) => {
      const dto = plainToInstance(InstagramDto, { ...basePayload, post_type });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'post_type')).toHaveLength(0);
    }
  );

  it('rejects an invalid post_type value', async () => {
    const dto = plainToInstance(InstagramDto, {
      ...basePayload,
      post_type: 'foo',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'post_type')).toBe(true);
  });

  it('rejects a missing post_type', async () => {
    const dto = plainToInstance(InstagramDto, {});
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'post_type')).toBe(true);
  });

  describe('share_to_feed', () => {
    it('is valid when absent', async () => {
      const dto = plainToInstance(InstagramDto, { ...basePayload, post_type: 'reel' });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'share_to_feed')).toHaveLength(0);
    });

    it('is valid when a boolean', async () => {
      const dto = plainToInstance(InstagramDto, {
        post_type: 'reel',
        share_to_feed: false,
      });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'share_to_feed')).toHaveLength(0);
    });
  });

  describe('cover_url', () => {
    it('is valid when absent', async () => {
      const dto = plainToInstance(InstagramDto, { ...basePayload, post_type: 'reel' });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'cover_url')).toHaveLength(0);
    });

    it('is valid when a string', async () => {
      const dto = plainToInstance(InstagramDto, {
        post_type: 'reel',
        cover_url: 'https://cdn/cover.png',
      });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'cover_url')).toHaveLength(0);
    });

    it('rejects a non-string value', async () => {
      const dto = plainToInstance(InstagramDto, {
        post_type: 'reel',
        cover_url: 12345,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'cover_url')).toBe(true);
    });
  });

  describe('also_share_to_story', () => {
    it('is valid when absent', async () => {
      const dto = plainToInstance(InstagramDto, basePayload);
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'also_share_to_story')).toHaveLength(0);
    });

    it('is valid when a boolean', async () => {
      const dto = plainToInstance(InstagramDto, {
        ...basePayload,
        also_share_to_story: true,
      });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'also_share_to_story')).toHaveLength(0);
    });
  });

  describe('story_media_id', () => {
    it('is valid when absent', async () => {
      const dto = plainToInstance(InstagramDto, basePayload);
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'story_media_id')).toHaveLength(0);
    });

    it('is valid when a string', async () => {
      const dto = plainToInstance(InstagramDto, {
        ...basePayload,
        story_media_id: 'media-123',
      });
      const errors = await validate(dto);
      expect(errors.filter((e) => e.property === 'story_media_id')).toHaveLength(0);
    });

    it('rejects a non-string value', async () => {
      const dto = plainToInstance(InstagramDto, {
        ...basePayload,
        story_media_id: 12345,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'story_media_id')).toBe(true);
    });
  });
});
