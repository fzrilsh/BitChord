var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var MUSIC_ORIGIN = "https://music.youtube.com";
var WWW_ORIGIN = "https://www.youtube.com";
var ASSET_ALLOW = [
  /^https:\/\/www\.youtube\.com\/sw\.js_data$/,
  /^https:\/\/www\.youtube\.com\/s\/player\/[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]+\.js$/,
  /^https:\/\/www\.youtube\.com\/iframe_api$/
];
var SIGNED_ENDPOINTS = /* @__PURE__ */ new Set([
  "browse",
  "search",
  "player",
  "next",
  "music/get_search_suggestions",
  "account/account_menu",
  "account/accounts_list",
  "like/like",
  "like/removelike",
  "playlist/get_add_to_playlist",
  "browse/edit_playlist"
]);
var GENERATE_IT_PATH = "/yt/jnn/GenerateIT";
var GENERATE_IT_UPSTREAM = `${WWW_ORIGIN}/api/jnn/v1/GenerateIT`;
function signedEndpoint(pathname) {
  if (!pathname.startsWith("/yt/")) return null;
  const endpoint = pathname.slice(4);
  return SIGNED_ENDPOINTS.has(endpoint) ? endpoint : null;
}
__name(signedEndpoint, "signedEndpoint");
function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((origin2) => origin2.trim().replace(/\/+$/, "")).filter(Boolean);
  const origin = request.headers.get("Origin");
  const allowOrigin = allowed.length === 0 ? "*" : origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    // x-goog-api-key and x-user-agent are what BotGuard's GenerateIT sends.
    "Access-Control-Allow-Headers": "Content-Type, X-Bitchord-Cookie, X-Bitchord-Auth, X-Goog-AuthUser, X-Goog-PageId, X-Bitchord-Token, X-Goog-Api-Key, X-User-Agent",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Type, Content-Length, X-Upstream-Status",
    Vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...corsHeaders(request, env) }
  });
}
__name(json, "json");
function youtubeHeaders(origin) {
  const headers = new Headers();
  headers.set("Origin", origin);
  headers.set("Referer", `${origin}/`);
  headers.set("X-Origin", origin);
  headers.set(
    "User-Agent",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
  );
  return headers;
}
__name(youtubeHeaders, "youtubeHeaders");
async function handleResolve(request, env, url) {
  const target = url.searchParams.get("u");
  if (!target || !/^https:\/\/[a-z0-9-]+\.googlevideo\.com\//.test(target)) {
    return json(request, env, { error: "u must be a googlevideo URL" }, 400);
  }
  let current = target;
  for (let hop = 0; hop < 3; hop++) {
    const response = await fetch(current, { method: "GET", headers: { Range: "bytes=0-0" }, redirect: "manual" });
    await response.arrayBuffer().catch(() => void 0);
    if (response.status < 300 || response.status >= 400) {
      return json(request, env, { url: current, status: response.status });
    }
    const location = response.headers.get("Location");
    if (!location) return json(request, env, { url: current, status: response.status });
    current = new URL(location, current).toString();
  }
  return json(request, env, { url: current, status: 302 });
}
__name(handleResolve, "handleResolve");
async function handleAsset(request, env, url) {
  const target = url.searchParams.get("u");
  if (!target || !ASSET_ALLOW.some((pattern) => pattern.test(target))) {
    return json(request, env, { error: "u must be a YouTube asset this Worker serves" }, 400);
  }
  const upstream = await fetch(target, { headers: youtubeHeaders(WWW_ORIGIN) });
  const body = await upstream.arrayBuffer();
  const cacheable = target.includes("/s/player/");
  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/javascript; charset=utf-8",
      "cache-control": cacheable ? "public, max-age=86400, immutable" : "public, max-age=300",
      "x-upstream-status": String(upstream.status),
      ...corsHeaders(request, env)
    }
  });
}
__name(handleAsset, "handleAsset");
async function handleSigned(request, env, url) {
  if (env.RELAY_TOKEN && request.headers.get("x-bitchord-token") !== env.RELAY_TOKEN) {
    return json(request, env, { error: "bad relay token" }, 401);
  }
  const anonymous = url.pathname === GENERATE_IT_PATH;
  const endpoint = anonymous ? null : signedEndpoint(url.pathname);
  if (!anonymous && !endpoint) {
    return json(request, env, { error: `not a signed endpoint: ${url.pathname}` }, 403);
  }
  const headers = youtubeHeaders(anonymous ? WWW_ORIGIN : MUSIC_ORIGIN);
  if (anonymous) {
    for (const name of ["x-goog-api-key", "x-user-agent", "content-type"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
  } else {
    headers.set("Content-Type", "text/plain;charset=UTF-8");
    const cookie = request.headers.get("x-bitchord-cookie");
    const auth = request.headers.get("x-bitchord-auth");
    if (!cookie || !auth) return json(request, env, { error: "missing session" }, 401);
    headers.set("Cookie", cookie);
    headers.set("Authorization", auth);
    const authUser = request.headers.get("x-goog-authuser");
    if (authUser) headers.set("X-Goog-AuthUser", authUser);
    const pageId = request.headers.get("x-goog-pageid");
    if (pageId) headers.set("X-Goog-PageId", pageId);
  }
  const target = anonymous ? GENERATE_IT_UPSTREAM : `${MUSIC_ORIGIN}/youtubei/v1/${endpoint}${url.search}`;
  const upstream = await fetch(target, {
    method: "POST",
    headers,
    body: await request.text()
  });
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
      "x-upstream-status": String(upstream.status),
      "cache-control": "no-store",
      ...corsHeaders(request, env)
    }
  });
}
__name(handleSigned, "handleSigned");
async function handleWhoami(request, env) {
  const response = await fetch("https://api.ipify.org?format=json");
  const body = await response.json();
  return json(request, env, { egressIp: body.ip ?? "unknown" });
}
__name(handleWhoami, "handleWhoami");
var src_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json(request, env, { ok: true });
      if (url.pathname === "/whoami") return await handleWhoami(request, env);
      if (url.pathname === "/asset") return await handleAsset(request, env, url);
      if (url.pathname === "/resolve") return await handleResolve(request, env, url);
      if (url.pathname.startsWith("/yt/")) return await handleSigned(request, env, url);
      return json(request, env, { error: "not found" }, 404);
    } catch (error) {
      console.error(`${url.pathname} failed: ${error instanceof Error ? error.name : "error"}`);
      return json(request, env, { error: "upstream failure" }, 502);
    }
  }
};

// ../node_modules/.pnpm/wrangler@4.157.0_@cloudflare+workers-types@5.20261104.1_@types+node@22.20.5/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/.pnpm/wrangler@4.157.0_@cloudflare+workers-types@5.20261104.1_@types+node@22.20.5/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-Oea2q7/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../node_modules/.pnpm/wrangler@4.157.0_@cloudflare+workers-types@5.20261104.1_@types+node@22.20.5/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-Oea2q7/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
