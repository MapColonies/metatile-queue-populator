import { QueueNames } from '@src/tiles/jobQueueProvider/queuesNameFactory';

export const queueNames: QueueNames & { [x: string]: string } = {
  requestTestQueue: 'tiles-requests-test-requests',
  requestQueue: 'tiles-requests-test',
  tilesQueue: 'tiles-test',
};
