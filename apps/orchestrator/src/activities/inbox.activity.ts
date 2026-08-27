import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';

@Injectable()
@Activity()
export class InboxActivity {
  constructor(
    private _inboxService: InboxService,
    private _integrationRepository: IntegrationRepository
  ) {}

  @ActivityMethod()
  async syncAllOrganizationInboxes() {
    const orgIds =
      await this._integrationRepository.getOrganizationIdsWithActiveSocial();

    let upserted = 0;
    const errors: string[] = [];

    for (const orgId of orgIds) {
      try {
        const result = await this._inboxService.syncOrganization(orgId);
        upserted += result.upserted;
        errors.push(...result.errors.map((e) => `${orgId}: ${e}`));
      } catch (err) {
        errors.push(
          `${orgId}: ${err instanceof Error ? err.message : 'sync failed'}`
        );
      }
    }

    return {
      organizations: orgIds.length,
      upserted,
      errorCount: errors.length,
    };
  }
}
