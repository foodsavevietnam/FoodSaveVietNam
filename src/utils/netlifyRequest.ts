type RequestPaths = {
  path?: string;
  rawPath?: string;
  requestPath?: string;
};

/** Keep original public paths and normalize paths rewritten by Netlify. */
export const normalizeNetlifyApiEvent = <Event extends RequestPaths>(event: Event, apiBasePath: string): Event => {
  const functionPrefix = "/.netlify/functions/api";
  const base = apiBasePath.replace(/\/+$/u, "");
  const normalize = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    if (value !== functionPrefix && !value.startsWith(`${functionPrefix}/`)) return value;
    const suffix = value.slice(functionPrefix.length) || "/";
    if (suffix === base || suffix.startsWith(`${base}/`)) return suffix;
    return `${base}${suffix}`;
  };

  // Preserve absent properties and all other Lambda fields, including queries,
  // methods, body encoding, and trusted platform request context.
  return {
    ...event,
    ...(event.path !== undefined ? { path: normalize(event.path) } : {}),
    ...(event.rawPath !== undefined ? { rawPath: normalize(event.rawPath) } : {}),
    ...(event.requestPath !== undefined ? { requestPath: normalize(event.requestPath) } : {}),
  };
};
