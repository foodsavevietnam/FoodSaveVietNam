import serverless from 'serverless-http';
import { app } from '../../src/app';
import { env } from '../../src/config/env';
import { normalizeNetlifyApiEvent } from '../../src/utils/netlifyRequest';

const serve = serverless(app);

type NetlifyApiEvent = Parameters<typeof normalizeNetlifyApiEvent>[0] & Record<string, unknown>;

export const handler = (event: NetlifyApiEvent, context: Parameters<typeof serve>[1]) =>
  serve(normalizeNetlifyApiEvent(event, env.API_BASE_PATH), context);
