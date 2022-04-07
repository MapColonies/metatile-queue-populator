# metatile-queue-populator
This service goal is to facilitate the filling of the tile rendering queue.
One part is responsible for adding tiles to the tiles-queue based on a request-queue, while the other is an API to insert requests into the queue.

## request-queue
This pg-boss queue holds all the pending requests for adding to the tiles queue.
Its possible to add requests directly into the queue.
The queue name is `tiles-requests-${projectName}`
And the request should be as follows:
```json
{
    "bbox": [
        -90,
        -90,
        90,
        90
    ],
    "minZoom": 14,
    "maxZoom": 14,
    "source": "expiredTiles"
}
```

## tiles-queue
This is the tile to which stores all the tiles that should be rendered.
The queue name is: `tiles-${projectName}`

## config
- APP_PROJECT_NAME - affects the name of the queues
- APP_ENABLE_REQUEST_QUEUE_HANDLING - should this instance work on the request queue, or only api
- APP_REQUEST_QUEUE_CHECK_INTERVAL_SEC
- APP_TILES_BATCH_SIZE - how many tiles should be pushed into the queue at once
- APP_METATILE_SIZE
- DB_JOBS_EXPIRE_IN_SECONDS - How many seconds a job may be in active state before it is failed because of expiration. Must be >=1
- DB_JOBS_RETRY_BACKOFF - Default: true. Enables exponential backoff retries based on retryDelay instead of a fixed delay. Sets initial retryDelay to 1 if not set.
- DB_JOBS_RETRY_LIMIT - Max number of retries of failed jobs. Default is 3 retries.
- DB_JOBS_RETRY_DELAY - Default: 60. Delay between retries of failed jobs, in seconds.
- DB_JOBS_RETENTION_HOURS - How many hours a job may be in created or retry state before it's archived. Must be >=1