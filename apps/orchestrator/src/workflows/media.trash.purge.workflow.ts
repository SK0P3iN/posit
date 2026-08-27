import { proxyActivities, sleep } from '@temporalio/workflow';
import { MediaActivity } from '@gitroom/orchestrator/activities/media.activity';

const { purgeExpiredMediaTrash } = proxyActivities<MediaActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

export async function mediaTrashPurgeWorkflow() {
  await purgeExpiredMediaTrash();
  while (true) {
    await sleep('1 day');
    await purgeExpiredMediaTrash();
  }
}
