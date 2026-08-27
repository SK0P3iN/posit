import {
  All,
  Controller,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PostizClient } from '@gitroom/saas-bff/postiz/postiz.client';

@Controller('/v1')
export class PostizProxyController {
  constructor(private readonly postizClient: PostizClient) {}

  @All('*path')
  async proxy(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    if (!request.saasUser) {
      throw new UnauthorizedException();
    }

    const suffix = request.originalUrl.replace(/^\/v1/, '') || '/';

    const result = await this.postizClient.request(
      request.saasUser.postizApiKey,
      request.method,
      suffix,
      ['GET', 'HEAD', 'DELETE'].includes(request.method.toUpperCase())
        ? undefined
        : request.body
    );

    response.status(result.status);
    return result.body;
  }
}
