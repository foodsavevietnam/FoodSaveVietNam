// @ts-ignore
import serverless from 'serverless-http';
import { app } from '../../src/app';
import { env } from '../../src/config/env';
import { normalizeNetlifyApiEvent } from '../../src/utils/netlifyRequest';

const serve = serverless(app);

export const handler = (event: Parameters<typeof serve>[0], context: Parameters<typeof serve>[1]) =>
  serve(normalizeNetlifyApiEvent(event, env.API_BASE_PATH), context);
