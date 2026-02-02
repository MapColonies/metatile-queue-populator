# metatile-queue-populator
This service goal is to facilitate the filling of the tile rendering queue.

There are two queues being handled, the `request-queue` and the `tile-queue`.

`metatile-queue-populator` fetches requests from the `tiles-request-queue` and fills the `tiles-queue`.
`tiles-request-queue` is being filled by either `osm2pgsql-wrapper` or by an api exposed by this service.
`tiles-queue` is read by `retiler`

## tiles-request-queue
This pg-boss queue holds all the pending requests to be added to the `tiles-queue`.
The queue is named `tiles-requests-${projectName}`
It's possible to add requests directly into the queue or via the api.
each request holds a single or an array of geographical areas depicted by bbox or geojson and the zoom levels to be rendered

for example a bbox request payload from `osm2pgsql-wrapper` is as follows:
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
This pg-boss queue holds all the pending metatiles that should be rendered,
The queue name is: `tiles-${projectName}` and its being handled by `retiler`
each item on this queue is a metatile in the size of metatile property located in `z/x/y` that should be rendered, the parent property is the `tiles-request-queue` item id that resulted in this tile
```json
{
  "x": 39103,
  "y": 10542,
  "z": 18,
  "parent": "39b94b1e-4fbe-47f1-bac3-d91e5c2c2d7e",
  "metatile": 8
}
```

## config
- `APP_PROJECT_NAME` - affects the name of the queues
- `APP_ENABLE_REQUEST_QUEUE_HANDLING` - should this instance work on the request queue, or only api
- `APP_REQUEST_QUEUE_CHECK_INTERVAL_SEC`
- `APP_TILES_BATCH_SIZE` - how many tiles should be pushed into the queue at once
- `APP_METATILE_SIZE` - Default: 8. a numeric value, each tile will be rendered from a `APP_METATILE_SIZE`x`APP_METATILE_SIZE` sized request
- `QUEUE_JOBS_EXPIRE_IN_SECONDS` - How many seconds a job may be in active state before it is failed because of expiration. Must be >=1
- `QUEUE_JOBS_RETRY_BACKOFF` - Default: true. Enables exponential backoff retries based on retryDelay instead of a fixed delay. Sets initial retryDelay to 1 if not set.
- `QUEUE_JOBS_RETRY_LIMIT` - Default: 3. Max number of retries of failed jobs.
- `QUEUE_JOBS_RETRY_DELAY_SECONDS` - Default: 60. Delay between retries of failed jobs, in seconds.
- `QUEUE_JOBS_RETENTION_HOURS` - Default: 87660. How many hours a job may be in created or retry state before it's archived. Must be >=1
- `APP_CONSUME_CONDITION_ENABLED` - Should enable consume condition (e.g. condition if to populate the queue).
- `APP_CONSUME_CONDITION_CHECK_INTERVAL_SEC` - Interval until next job if consume condition is falsy. 
- `APP_CONSUME_CONDITION_TILES_QUEUE_SIZE_LIMIT` - Limit the size of the PGBOSS queue.