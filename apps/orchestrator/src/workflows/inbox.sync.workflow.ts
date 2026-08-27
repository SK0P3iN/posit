import { proxyActivities, sleep } from '@temporalio/workflow';
import { InboxActivity } from '@gitroom/orchestrator/activities/inbox.activity';

const { syncAllOrganizationInboxes } = proxyActivities<InboxActivity>({
  startToCloseTimeout: '30 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

export async function inboxSyncWorkflow() {
  await syncAllOrganizationInboxes();
  while (true) {
    await sleep('15 minutes');
    await syncAllOrganizationInboxes();
  }
}
