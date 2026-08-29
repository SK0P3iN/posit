import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePublicCommentDto } from './create.public.comment.dto';

describe('CreatePublicCommentDto', () => {
  it('accepts a valid name and content', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: 'Jane Reviewer',
      content: 'Looks great!',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a missing name', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      content: 'Looks great!',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a missing content', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: 'Jane Reviewer',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects a name over 100 characters', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: 'a'.repeat(101),
      content: 'Looks great!',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects content over 2000 characters', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: 'Jane Reviewer',
      content: 'a'.repeat(2001),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects an empty-string name', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: '',
      content: 'Looks great!',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects a whitespace-only name', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: '   ',
      content: 'Looks great!',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'name')).toBe(true);
  });

  it('rejects an empty-string content', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: 'Jane Reviewer',
      content: '',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('rejects a whitespace-only content', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: 'Jane Reviewer',
      content: '   ',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'content')).toBe(true);
  });

  it('trims leading/trailing whitespace from name and content', async () => {
    const dto = plainToInstance(CreatePublicCommentDto, {
      name: '  Jane  ',
      content: '  Looks great!  ',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.name).toBe('Jane');
    expect(dto.content).toBe('Looks great!');
  });
});
