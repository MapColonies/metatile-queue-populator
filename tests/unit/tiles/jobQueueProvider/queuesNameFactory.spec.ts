import { container } from 'tsyringe';
import { ConfigType } from '@src/common/config';
import { SERVICES } from '@src/common/constants';
import { queuesNameFactory } from '@src/tiles/jobQueueProvider/queuesNameFactory';

describe('queuesNameFactory', () => {
  it('should create queue names from project name', () => {
    const childContainer = container.createChildContainer();
    const configMock = {
      get: jest.fn().mockReturnValue({ projectName: 'demo' }),
    } as unknown as ConfigType;

    childContainer.registerInstance(SERVICES.CONFIG, configMock);

    const names = queuesNameFactory(childContainer);

    expect(names).toEqual({
      requestQueue: 'tiles-requests-demo',
      tilesQueue: 'tiles-demo',
    });
  });
});
