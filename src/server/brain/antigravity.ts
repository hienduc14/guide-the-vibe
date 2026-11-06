// Google Antigravity ("log in with Google": Gemini, plus Claude/GPT-OSS through Google's quota), taken from the
// community Pi extension pi-antigravity (pinned in package.json). Only its OAuth flow, static model list and
// transport are used, wrapped as a pi-ai provider: no slash commands, search or images, and its multi-account file
// under ~/.pi is never written (login/refresh here skip its "remember account" step; tokens live in hub.db).
//
// The package ships TypeScript source and Node refuses to strip types under node_modules, so a module hook
// strips them for that one package. shortcut: experimental Node API (module.stripTypeScriptTypes); if a Node
// upgrade breaks it, bundle the package with esbuild at build time instead.

import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import { createProvider, type Api, type OAuthCredential, type Provider } from "@earendil-works/pi-ai";

const PKG = "/node_modules/pi-antigravity/";

registerHooks({
  // Its relative imports say "./x.js" for "./x.ts".
  resolve: (spec, ctx, next) => next(ctx.parentURL?.includes(PKG) && spec.startsWith(".") ? spec.replace(/\.js$/, ".ts") : spec, ctx),
  load: (url, ctx, next) =>
    url.includes(PKG) && url.endsWith(".ts")
      ? { format: "module", shortCircuit: true, source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8")) }
      : next(url, ctx),
});

// Variable specifiers keep tsc from type-checking the package's source with our settings.
const load = (path: string) => import(`pi-antigravity/src/${path}`);
const [oauth, models, stream, client] = await Promise.all([
  load("auth/oauth.ts"),
  load("models/models.ts"),
  load("stream/stream.ts"),
  load("client/client.ts"),
]);

export const ANTIGRAVITY = models.PROVIDER_ID as string; // "antigravity"

export function antigravityProvider(): Provider {
  const api = stream.ANTIGRAVITY_API as Api;
  const oauthCred = async (c: Promise<object>): Promise<OAuthCredential> => ({ ...(await c), type: "oauth" }) as OAuthCredential;
  return createProvider({
    id: ANTIGRAVITY,
    name: models.PROVIDER_NAME,
    baseUrl: client.DEFAULT_ENDPOINT,
    auth: {
      oauth: {
        name: "Antigravity (Google account)",
        isSubscription: true,
        // Its flow uses Pi's older callback API; map it onto pi-ai's interaction.
        login: (i) =>
          oauthCred(
            oauth.loginAntigravity({
              onAuth: (a: { url: string; instructions?: string }) => i.notify({ type: "auth_url", url: a.url, instructions: a.instructions }),
              onDeviceCode: (d: { userCode: string; verificationUri: string }) => i.notify({ type: "device_code", ...d }),
              onPrompt: (p: { message: string; placeholder?: string }) => i.prompt({ type: "manual_code", ...p }),
              onProgress: (message: string) => i.notify({ type: "progress", message }),
              onSelect: async () => undefined,
              signal: i.signal,
            }),
          ),
        refresh: (c) => oauthCred(oauth.refreshAntigravityToken(c)),
        // Its transport takes a JSON "api key": {token, projectId}.
        toAuth: async (c) => ({ apiKey: oauth.getApiKey(c) as string }),
      },
    },
    models: (models.getCurrentAntigravityCatalog().models as object[]).map((m) => ({
      ...m,
      api,
      provider: ANTIGRAVITY,
      baseUrl: client.DEFAULT_ENDPOINT,
    })) as never,
    api: { stream: stream.streamAntigravity, streamSimple: stream.streamAntigravity },
  });
}
