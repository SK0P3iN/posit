import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { GetInboxDto } from '@gitroom/nestjs-libraries/dtos/inbox/get.inbox.dto';
import { ReplyInboxDto } from '@gitroom/nestjs-libraries/dtos/inbox/reply.inbox.dto';
import { LikeInboxCommentDto } from '@gitroom/nestjs-libraries/dtos/inbox/like.inbox.comment.dto';

@ApiTags('Inbox')
@Controller('/inbox')
export class InboxController {
  constructor(private _inboxService: InboxService) {}

  @Get('/')
  list(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetInboxDto
  ) {
    return this._inboxService.list(org.id, query);
  }

  @Get('/capabilities')
  capabilities(@GetOrgFromRequest() org: Organization) {
    return this._inboxService.listChannelCapabilities(org.id);
  }

  @Get('/sync-status')
  syncStatus(@GetOrgFromRequest() org: Organization) {
    return this._inboxService.getSyncStatus(org.id);
  }

  @Post('/sync')
  sync(@GetOrgFromRequest() org: Organization) {
    return this._inboxService.syncOrganization(org.id);
  }

  @Get('/:id')
  get(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._inboxService.getById(org.id, id);
  }

  @Put('/:id/read')
  markRead(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._inboxService.markRead(org.id, id);
  }

  @Post('/:id/reply')
  reply(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: ReplyInboxDto
  ) {
    return this._inboxService.reply(org.id, id, body.message);
  }

  @Get('/thread/:integrationId/:postRemoteId')
  getThread(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Param('postRemoteId') postRemoteId: string
  ) {
    return this._inboxService.getThread(org.id, integrationId, postRemoteId);
  }

  @Post('/comment/:integrationId/:commentRemoteId/like')
  likeComment(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Param('commentRemoteId') commentRemoteId: string,
    @Body() body: LikeInboxCommentDto
  ) {
    return this._inboxService.likeComment(
      org.id,
      integrationId,
      commentRemoteId,
      body.liked
    );
  }

  @Post('/comment/:integrationId/:commentRemoteId/reply')
  replyToComment(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Param('commentRemoteId') commentRemoteId: string,
    @Body() body: ReplyInboxDto
  ) {
    return this._inboxService.replyToComment(
      org.id,
      integrationId,
      commentRemoteId,
      body.message
    );
  }

  @Delete('/:id')
  delete(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._inboxService.deleteItem(org.id, id);
  }
}
