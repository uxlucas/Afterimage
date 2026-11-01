# Deploying

```bash
npx afterimage build
```

`build` writes one static site to `.afterimage/site/`: your app at the root, exactly as its own build makes it, and the history at `/afterimage/`, with the viewer and every saved version. Serve it from the root of a domain, on a static host that meets [the requirements below](#other-static-hosts). On Vercel and Netlify you don't run it yourself: the config `init` wrote has the host run the same build on every deploy.

> The Vercel settings on this page have been checked on real Vercel deployments of all four framework examples with afterimage-cli 0.1.0 ([results](checking-a-deploy.md#results)). The Netlify settings come from Netlify's documentation and from reading its build tools' source code, and haven't been checked on a real Netlify deploy yet. [checking-a-deploy.md](checking-a-deploy.md) is the procedure for that.

## Why /afterimage

- **The viewer needs the same site.** To find what changed, the viewer reads each version's page, and a browser only lets a page read pages from its own site. So the versions are served from the site the viewer is on.
- **Your app stays as it is.** The live app keeps the root, loaded from its own build's files. The service worker that lets built apps load inside versions is registered for `/afterimage/` only, so it never controls the live app.
- **The history travels with the app.** Each deployment carries the versions saved up to that commit, at a fixed address: `yoursite.com/afterimage/`.

## What to commit

The host only sees what is in git. Commit:

- `afterimage/`, the saved versions and `versions.json`
- `afterimage.config.json`
- `package.json` and your lockfile, with `afterimage-cli` in `devDependencies`
- `.gitattributes`
- `vercel.json` or `netlify.toml`, for the host you use

`.afterimage/` is git-ignored: the host rebuilds it.

## Vercel

For a Next.js project, `init` writes this `vercel.json`. Other projects get the same file without `"framework": null`.

```json
{
  "framework": null,
  "buildCommand": "npm run afterimage:build",
  "outputDirectory": ".afterimage/site",
  "rewrites": [
    {
      "source": "/:path((?!afterimage/|afterimage$).+)",
      "destination": "/:path*.html"
    }
  ],
  "redirects": [
    {
      "source": "/afterimage",
      "destination": "/afterimage/"
    }
  ]
}
```

In the project's settings on Vercel, leave the Build Command and Output Directory overrides off, so `vercel.json` supplies them, and build with Node.js 22 or later.

What each setting is for:

- **`buildCommand` and `outputDirectory`.** Vercel runs Afterimage's build, which runs your own build first, and serves the combined site. The command goes through the package script so the project's own copy of Afterimage runs.
- **`"framework": null`, only for projects that depend on `next`.** Without it, Vercel's Next.js builder treats the output folder as its own and the deploy fails, since `.afterimage/site/` has none of the files it expects (`routes-manifest.json`). `null` is Vercel's "Other" preset, which serves the output folder as plain files. It is keyed on the dependency, not on what init detected, because Vercel picks the framework from `package.json`. The cost: the Next.js builder's long cache headers on `_next/static` go, and so does its clean-URL handling, which the rewrite below brings back. Vite, Astro and SvelteKit keep their presets, which serve `outputDirectory` and add their own cache headers.
- **The rewrite.** It gives the live app clean URLs: `/about` is answered from `about.html` when no file is called `about`. Next.js and SvelteKit static builds write `about.html` and link to `/about`, and Vercel doesn't do this for a plain folder on its own. A rewrite isn't a redirect, Vercel only uses it when no file matches the path, and this one leaves `/afterimage` and everything under it out.
- **The redirect.** Vercel answers `/afterimage` without the slash with the viewer's page, whose files are relative and would then load from the root. The redirect adds the slash. It matches that exact path, so `/afterimage/` isn't caught and nothing loops.

### An existing vercel.json

`init` keeps everything else in the file. Your own rewrites and redirects stay first, and Afterimage's are added after them, once.

- **A different `buildCommand` or `outputDirectory`,** or a named `framework` in a Next.js project: init asks before it switches them. Answer no, or run it with `--no-input`, and it leaves the file as it is and prints what to set.
- **`"cleanUrls": true`:** init leaves it, doesn't add the rewrite, and warns on every run. `cleanUrls` redirects every `.html` path site-wide, including the history's own pages, such as `/afterimage/versions/v2/index.html`, and the viewer can't follow a version out of its folder. Remove it: the rewrite gives the live app clean URLs without touching `/afterimage/`.
- **`trailingSlash`, set to `true` or `false`:** init leaves it, adds neither the rewrite nor the redirect, and warns on every run. `true` adds a slash to paths under `/afterimage/`, so a version's pages aren't asked for the way Afterimage expects. `false` takes the slash off `/afterimage/`, so the viewer's files load from the wrong folder. Remove it.
- **A redirect of your own from `/afterimage` to somewhere else:** it shadows the history. init leaves it and says so.

### Astro with @astrojs/vercel

The adapter writes Vercel's own `.vercel/output` on every build, and Vercel deploys that folder instead of the Afterimage site, so `/afterimage/` won't be there. init says so whenever `package.json` depends on `@astrojs/vercel`. A static site doesn't need the adapter: remove `@astrojs/vercel`, and its adapter line in the astro config, to deploy the history on Vercel. Without `output: 'static'` in the astro config, init stops earlier, since there is no static build to save.

### The VERCEL variable

Vercel sets the `VERCEL` environment variable while it builds, and some tools take it as a cue to write Vercel's own deployment format instead of plain files. SvelteKit's `adapter-static`, for one, then writes `.vercel/output` and never its usual `build/` folder. Afterimage runs your build command without `VERCEL`, so the build makes the same plain static files on Vercel as on your laptop. Every other variable, `VERCEL_URL` included, is passed through. This applies to `save` as well as `build`.

## Netlify

`init` writes this `netlify.toml`. The `[build.environment]` part is only for projects that depend on `next`.

```toml
[build]
  command = "npm run afterimage:build"
  publish = ".afterimage/site"

[build.environment]
  NETLIFY_NEXT_PLUGIN_SKIP = "true"
```

- **`command` and `publish`.** Netlify runs Afterimage's build and publishes the combined site.
- **`NETLIFY_NEXT_PLUGIN_SKIP`.** Netlify installs its Next.js runtime for every Next.js project. After the build, the runtime copies the static export's `out/` folder over the publish folder, so `/afterimage/` wouldn't deploy. The variable makes the runtime step aside.
- **No rewrite.** Netlify answers `/about` from `about.html` on its own.

An existing `netlify.toml` is never edited: a hand edit is safer than a guessed merge. init prints the lines to add, and stops printing them once they are there.

Build with Node 22 or later. On Netlify, the `NODE_VERSION` environment variable sets it.

## Other static hosts

Run `npm run afterimage:build` as the build step and publish `.afterimage/site`, or build on your machine and upload that folder. The host has to:

- **Serve the site from the root of its domain.** The history lives at `/afterimage/` and the frame runtime at `/afterimage/frame.js`, both from the root. A site under a sub-path, such as a GitHub Pages project site at `you.github.io/repo/`, doesn't work.
- **Use https.** Versions load through a service worker, and browsers only run service workers on https or on localhost. See [Service workers](#service-workers).
- **Serve `sw.js` as JavaScript,** with a JavaScript content type.
- **Answer a folder path with its `index.html`,** so `/afterimage/` gives `afterimage/index.html`.
- **Leave paths under `/afterimage/` alone:** no redirect that adds or removes a trailing slash, and none that strips `.html`.
- **Answer a missing file with a 404,** under `/afterimage/` too. Inside a version, Afterimage answers a missing `/about` from `about.html` or `about/index.html` itself, as Netlify would, but only after a 404. Hosts that answer 403 for a missing file, as S3 and similar object stores do, get no such fallback, and a catch-all rule that answers every path with your app's page hides the 404.

Afterimage handles clean URLs inside versions, not for the live app. If your app links to `/about` and its build writes `about.html` (Next.js and SvelteKit do), the host has to answer `/about` from `about.html` for the live app to work, as it would without Afterimage.

## Preview deployments

Vercel builds a preview for every branch you push, and Netlify builds a deploy preview for every pull request, both with the same config. So each preview deployment carries that branch's live prototype and the versions saved on it, at `/afterimage/` on the preview's own address. There is nothing extra to set up.

- A preview can sit behind the host's login, such as Vercel's Deployment Protection. Whoever you send a preview link to needs access to it.
- Versions are numbered in order. Two branches that each save a version both make the same next number, and git can't merge the two. Save versions on one branch at a time, and merge it before saving on another.

## Service workers

Built apps load their files from root paths, such as `/assets/index.js` or `/_next/static/...`. Inside the viewer a version lives at `/afterimage/versions/v2/`, so those paths would reach the live app. A service worker, served at `/afterimage/sw.js`, answers them from the version's own folder instead. In a frame the worker controls, each saved page also moves its own address to the app's path, `/about` instead of `/afterimage/versions/v2/about`, so the app's router sees the paths it expects, and the worker maps what the page asks for back into the version.

Browsers only run service workers on https and on localhost, which is why the history needs https once it is deployed. `afterimage dev` serves on localhost, so it works while you build. Without a worker (plain http on a public address, or a host that won't serve `sw.js` as JavaScript) the viewer still opens, and each page keeps its own address in the version folder. Files it names with relative paths, such as `style.css`, still load from the version, so plain HTML shows as saved. Root paths reach the live app instead, so a built app can show up unstyled, and its router, which sees `/afterimage/versions/v2/` instead of `/`, can show its not-found page.
