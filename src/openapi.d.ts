/* eslint-disable */
import type { TypedRequestHandlers as ImportedTypedRequestHandlers } from '@map-colonies/openapi-helpers/typedRequestHandler';
export type paths = {
  '/tiles/list': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** Add metatiles to the queue */
    post: operations['postTilesList'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/tiles/area': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    /** add the all the meta tiles in the given area and zoom range into the queue, area is a geojson or bbox */
    post: operations['postTilesByArea'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
};
export type webhooks = Record<string, never>;
export type components = {
  schemas: {
    Error: {
      message: string;
    };
    /** @description Geojson geometry */
    Geometry: {
      /**
       * @description the geometry type
       * @enum {string}
       */
      type: 'Point' | 'LineString' | 'Polygon' | 'MultiPoint' | 'MultiLineString' | 'MultiPolygon';
    };
    /** @description Point in 3D space */
    Point3D: number[];
    /** @description Geojson geometry */
    Point: {
      type: 'Point';
    } & (Omit<components['schemas']['Geometry'], 'type'> & {
      coordinates?: components['schemas']['Point3D'];
    });
    /** @description Geojson geometry */
    LineString: {
      type: 'LineString';
    } & (Omit<components['schemas']['Geometry'], 'type'> & {
      coordinates?: components['schemas']['Point3D'][];
    });
    /** @description Geojson geometry */
    Polygon: {
      type: 'Polygon';
    } & (Omit<components['schemas']['Geometry'], 'type'> & {
      coordinates?: components['schemas']['Point3D'][][];
    });
    /** @description Geojson geometry */
    MultiPoint: {
      type: 'MultiPoint';
    } & (Omit<components['schemas']['Geometry'], 'type'> & {
      coordinates?: components['schemas']['Point3D'][];
    });
    /** @description Geojson geometry */
    MultiLineString: {
      type: 'MultiLineString';
    } & (Omit<components['schemas']['Geometry'], 'type'> & {
      coordinates?: components['schemas']['Point3D'][][];
    });
    /** @description Geojson geometry */
    MultiPolygon: {
      type: 'MultiPolygon';
    } & (Omit<components['schemas']['Geometry'], 'type'> & {
      coordinates?: components['schemas']['Point3D'][][][];
    });
    /** @description Geojson Feature */
    Feature: {
      /** @enum {string} */
      type: 'Feature';
      geometry: components['schemas']['Geometry'];
      properties?: Record<string, never>;
    };
    /** @description Geojson Feature collection */
    FeatureCollection: {
      /** @enum {string} */
      type: 'FeatureCollection';
      features: components['schemas']['Feature'][];
    };
    TilesListRequest: {
      x: number;
      y: number;
      z: number;
      /** @default 1 */
      metatile: number;
    }[];
    BaseAreaRequest: {
      /** @description The minimum zoom for which metatiles will be calculated */
      minZoom: number;
      /** @description The maximum zoom for which metatiles will be calculated. note - the value should be higher or equal than minZoom */
      maxZoom: number;
    };
    BboxTilesRequest: components['schemas']['BaseAreaRequest'] & {
      /**
       * @description WGS84 bbox
       * @example [
       *       -90,
       *       -90,
       *       90,
       *       90
       *     ]
       */
      area: number[];
    };
    GeometryTilesRequest: components['schemas']['BaseAreaRequest'] & {
      area: components['schemas']['Feature'] | components['schemas']['FeatureCollection'];
    };
    MultiAreaTilesRequest: (components['schemas']['BboxTilesRequest'] | components['schemas']['GeometryTilesRequest'])[];
    force: boolean;
  };
  responses: {
    /** @description Bad request */
    BadRequest: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Error'];
      };
    };
    /** @description Conflict */
    Conflict: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Error'];
      };
    };
    /** @description Unexpected Error */
    UnexpectedError: {
      headers: {
        [name: string]: unknown;
      };
      content: {
        'application/json': components['schemas']['Error'];
      };
    };
  };
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
};
export type $defs = Record<string, never>;
export interface operations {
  postTilesList: {
    parameters: {
      query?: {
        /** @description force the request to be processed */
        force?: components['schemas']['force'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json': components['schemas']['TilesListRequest'];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** @description message */
            message?: string;
          };
        };
      };
      400: components['responses']['BadRequest'];
      '5XX': components['responses']['UnexpectedError'];
    };
  };
  postTilesByArea: {
    parameters: {
      query?: {
        /** @description force the request to be processed */
        force?: components['schemas']['force'];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        'application/json':
          | components['schemas']['BboxTilesRequest']
          | components['schemas']['GeometryTilesRequest']
          | components['schemas']['MultiAreaTilesRequest'];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': {
            /** @description message */
            message?: string;
          };
        };
      };
      400: components['responses']['BadRequest'];
      409: components['responses']['Conflict'];
      '5XX': components['responses']['UnexpectedError'];
    };
  };
}
export type TypedRequestHandlers = ImportedTypedRequestHandlers<paths, operations>;
