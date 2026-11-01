# Checking a deploy

A procedure for maintainers. It shows on a real Vercel preview and a real Netlify deploy what the test suite only checks against a local static server: that the host config `init` writes (see [deploying.md](deploying.md)) deploys the history at `/afterimage/` and leaves the live app at the root as its own build makes it.

**It has been run on Vercel and on Netlify**, for all four examples, with afterimage-cli 0.1.0. The [results](#results) are at the end of this page. Run it again when a host changes how it builds or serves a site, or when `init` changes the config it writes.

Run it for `examples/next-static` first, since it exercises every setting, then for `examples/astro`, `examples/sveltekit-static` and `examples/vite-react`. Nothing here deploys to production. It needs accounts on GitHub, Vercel and Netlify.

On Vercel, the copy can also be deployed from its folder with no Git remote: `vercel link --yes --project <a throwaway name>`, then `vercel deploy`. A new project's first deploy goes to that project's own production address, which is fine for a throwaway project; later deploys are previews. Instead of turning off Vercel Authentication, run each `curl` line below as `vercel curl <path> --deployment <url> -- -sI`, from the linked folder: it gets past the protection for your own deployments. In Git Bash, set `MSYS_NO_PATHCONV=1` first, or it turns `/` into a Windows path.

The commands are for bash: Git Bash on Windows, or Linux. On macOS, use `shasum -a 256` for `sha256sum` and `sed -i ''` for `sed -i`.

Don't add a `pretty_urls` setting to `netlify.toml` before you run check G. G decides whether one is needed.

## 0. Make a throwaway copy from a package tarball

The examples depend on the checkout through `file:../..`, and `viewer-dist/` is git-ignored and only built by `prepack`, so a clone of this repo deployed as it is has no viewer. Deploy from a tarball instead: `npm pack` runs `prepack`, which builds the viewer.

From the root of a checkout of this repo:

```bash
mkdir -p ~/afterimage-deploy
npm pack --pack-destination ~/afterimage-deploy        # expect afterimage-cli-0.1.0.tgz, with viewer-dist/ in its file list
EX=next-static                                         # then astro, sveltekit-static, vite-react
tar -C examples --exclude=node_modules --exclude=.afterimage --exclude=.next --exclude=out --exclude=dist --exclude=build --exclude=package-lock.json -cf - $EX | tar -C ~/afterimage-deploy -xf -
cd ~/afterimage-deploy/$EX
mkdir vendor && cp ../afterimage-cli-0.1.0.tgz vendor/
npm install --save-dev ./vendor/afterimage-cli-0.1.0.tgz   # replaces file:../..
npm run afterimage:build && ls .afterimage/site/afterimage/index.html .afterimage/site/afterimage/sw.js
git init -q && git add -A && git commit -qm "deploy check" && git branch -M preview-check
sha256sum afterimage/versions/v1/index.html afterimage/versions/v2/index.html   # keep these: the committed bytes
```

The copy's `.gitattributes` keeps `afterimage/** -text`, so git won't touch those bytes.

Create an empty private repository on GitHub for the copy, for example `afterimage-deploy-check-next-static`, then push to it:

```bash
git remote add origin git@github.com:<you>/afterimage-deploy-check-next-static.git
git push -u origin preview-check                      # connect Vercel and Netlify to this repo and branch
```

Checks F and H also need these branches, each made from `preview-check`:

```bash
git switch -c baseline && git rm -q vercel.json netlify.toml && git commit -qm baseline && git push -u origin baseline && git switch preview-check
git switch -c no-null && sed -i '/"framework": null,/d' vercel.json && git commit -qam no-null && git push -u origin no-null && git switch preview-check
git switch -c no-skip && node -e "const fs=require('fs');fs.writeFileSync('netlify.toml',fs.readFileSync('netlify.toml','utf8').split('[build.environment]')[0].trimEnd()+'\n')" && git commit -qam no-skip && git push -u origin no-skip && git switch preview-check
```

Both hosts build each pushed branch as a branch or preview deployment. Use those branch URLs as `$BASELINE` and so on. Switch back to `preview-check` between branches, as the lines above do, so each one starts from the same files. (`vercel` run from the folder is an alternative that needs no remote. Netlify has no such alternative for this check, as the settings below explain.)

## 1. Project settings

**Vercel.** A new throwaway project from this repository, or `vercel link --yes` then `vercel` from the folder. Never run `vercel --prod`.

- Root Directory: empty, since the copy is the repository root. "Include source files outside of the Root Directory" isn't needed.
- Framework Preset: leave it on auto-detect, so detection is part of what is checked. Note what it shows: Next.js, Astro, SvelteKit or Vite.
- Build Command, Output Directory, Install Command: every Override off. `vercel.json` supplies the first two.
- Node.js Version: 22.x (Settings, General). Environment variables: none.
- Deployment Protection: turn Vercel Authentication off for this throwaway project, or the `curl` lines below get a 401.
- Preview URL: `V=https://<the preview host>`.

**Netlify.** A site connected to the Git repository. `netlify deploy --build` builds on your machine and doesn't run the Next.js runtime Netlify installs on its own, which is part of what is being checked.

- Base directory: empty. Build command and Publish directory: empty in the UI, since `netlify.toml` supplies them.
- Environment variable `NODE_VERSION=22`. Turn on branch deploys for `preview-check`.
- Before the first deploy, note whether Pretty URLs is on or off (Site configuration, Build and deploy, Post processing). Don't change it.
- Deploy URL: `N=https://<preview-check--site>.netlify.app`.
- One site can build all four examples from branches of one repository, with one catch. A site created from a Next.js branch gets Netlify's Next.js runtime for the whole site, and on the other examples' branches the runtime fails the build with `Your publish directory does not contain expected Next.js build output`. Turn it off for those branches only, which is what a site of their own would have: `netlify env:set NETLIFY_NEXT_PLUGIN_SKIP true --context branch:astro`, and the same for the others. Or make a site per example.

## 2. Checks

Run every line against both hosts, with `H` set to each in turn. Where Vercel and Netlify should differ, the expected result says so.

```bash
H=$V     # then H=$N
```

### A. Build logs

- Vercel: the log runs `npm run afterimage:build`. For sveltekit-static it must not mention `.vercel/output`; adapter-static prints `Wrote site to "build"`.
- Netlify, next-static: the log shows `Skipping Next.js plugin due to NETLIFY_NEXT_PLUGIN_SKIP environment variable.`

### B. The live app at the root

```bash
curl -sI $H/ | head -1                                  # 200
curl -sI $H/about | head -3                             # next-static, sveltekit-static: 200, no Location. astro: Vercel 200 at /about, Netlify 301 Location /about/
curl -sI $H/about.html | head -3                        # 200, no Location (a 308 here means cleanUrls is on)
curl -sI $H/missing | head -1; curl -s $H/missing | head -c 300   # 404 (not 200, not a redirect) and the app's own 404 page; on Vercel this goes through the rewrite
```

### C. The history at /afterimage

```bash
curl -sI $H/afterimage | head -5                        # Vercel 308 Location /afterimage/ (Afterimage's redirect); Netlify 301 Location /afterimage/
curl -sI $H/afterimage/ | head -3                       # 200 text/html
curl -sI $H/afterimage/sw.js | grep -i content-type     # javascript
curl -sI $H/afterimage/frame.js | head -2               # 200
curl -sI $H/afterimage/versions.json | head -2          # 200
curl -sI $H/afterimage/versions/v1/index.html | head -3 # 200, no Location (a 308 here means cleanUrls or trailingSlash)
curl -sI $H/afterimage/versions/v2/nope | head -1       # 404 (a 200 would mean a rewrite or catch-all answered inside /afterimage/)
```

In a browser, open `$H/afterimage/`. The viewer lists the versions, and switching versions renders them. In the console, `navigator.serviceWorker.getRegistration('/afterimage/').then(r => r && r.scope)` gives `.../afterimage/`. Then open `$H/` and check that `navigator.serviceWorker.controller` is `null`.

### D. Folder paths inside a version (astro)

```bash
curl -sI $H/afterimage/versions/v2/about | head -4      # Vercel: 200 at the URL with no slash. Netlify: 301 Location .../about/
```

In the viewer, open `$H/afterimage/?version=v2` and click "About this site" in the frame. The About page shows, and in the console `document.querySelector('iframe[data-role=target]').contentWindow.__afterimageVersion` is `"v2"`. Write down `__afterimageFile` on each host: the local static server in the tests gets `/afterimage/versions/v2/about/`, and Vercel is expected to give the form without the slash.

For next-static: `curl -sI $H/afterimage/versions/v2/about.html` is 200 with no Location, where that file exists in the saved version.

### E. SvelteKit on Vercel (sveltekit-static)

The log has no `.vercel/output` (check A). `curl -sI $V/ | head -1`, `curl -sI $V/about | head -1` and `curl -sI $V/afterimage/ | head -1` are all 200, and the viewer shows both versions. A 404 on `/afterimage/` means Vercel deployed `.vercel/output` again, so the build still saw the `VERCEL` variable.

### F. Cache headers, before and after

"Before" is the example deployed without Afterimage's host config: the `baseline` branch from step 0. For next-static on Netlify, that branch lets the runtime publish `out/`. Pick a hashed file from the local build (`ls out/_next/static/chunks`, `ls dist/_astro`):

```bash
curl -sI $BASELINE/_next/static/chunks/<file>.js | grep -i cache-control
curl -sI $H/_next/static/chunks/<file>.js | grep -i cache-control       # after: next-static
curl -sI $H/_astro/<file> | grep -i cache-control                       # astro, before and after
```

Vercel's baseline is expected to show `public, max-age=31536000, immutable` for Next.js and Astro. Astro keeps its preset, so its after should match its before. Next.js's after is expected to lose it, because of `"framework": null`. Write down what you see.

### G. Bytes as served (Netlify Pretty URLs)

Netlify's post processing can rewrite links in the HTML it serves, which would change a saved version.

```bash
cd ~/afterimage-deploy/$EX
for v in v1 v2; do curl -s --compressed $H/afterimage/versions/$v/index.html | sha256sum; sha256sum afterimage/versions/$v/index.html; done
```

Each pair must match. On a mismatch, run `curl -s --compressed $H/afterimage/versions/v1/index.html | diff - afterimage/versions/v1/index.html` and write down the diff. Only if it shows rewritten links is `[build.processing.html] pretty_urls = false` worth considering, as a separate change.

The saved versions are the real check for every example, since their bytes are committed. Compare the live root's hash for vite-react only (`EX=vite-react`):

```bash
curl -s --compressed $H/ | sha256sum; sha256sum .afterimage/site/index.html
```

For Next.js, Astro and SvelteKit, don't conclude anything from a mismatch at the root: their pages carry names and ids that differ from build to build. Rebuild locally first with the same tarball (`npm run afterimage:build`), then `diff <(curl -s --compressed $H/) .afterimage/site/index.html`, before putting it down to Pretty URLs.

### H. Negative controls (next-static only)

These confirm the settings are needed.

- Branch `no-null`, on Vercel: `"framework": null` is gone from `vercel.json`. Expect the deploy to fail: the Next.js builder looks for its own files (`routes-manifest.json`) in `.afterimage/site/` and doesn't find them. (This page first predicted a 404 on `/afterimage/`. The 2026-11-01 run showed the failed deploy instead.)
- Branch `no-skip`, on Netlify: the `[build.environment]` block is gone from `netlify.toml`. Expect `/afterimage/` to be a 404.

If either still answers 200, that setting isn't needed on that host, and the reading of its builder was wrong.

### I. Astro with @astrojs/vercel (Vercel only)

Make another copy of the astro example as in step 0, then:

```bash
npm install --save-dev @astrojs/vercel@<a current 8.x or 9.x, as Astro's docs list>
# astro.config.mjs: import vercel from '@astrojs/vercel'; add adapter: vercel() and output: 'static' to defineConfig
npx afterimage init                                  # expect the @astrojs/vercel note, exit 0
git switch -c astro-adapter && git add -A && git commit -qm adapter && git push -u origin astro-adapter
```

On the preview, run `curl -sI $V/ | head -1` (200) and `curl -sI $V/afterimage/ | head -1`. The note predicts that `/afterimage/` is a 404, because Vercel deployed the adapter's `.vercel/output`, and that the root is the app. Then, on a branch `astro-adapter-removed`, run `npm uninstall @astrojs/vercel`, delete the adapter lines from `astro.config.mjs`, push, and expect `/afterimage/` to be 200. A 200 on the first deploy means the note is wrong and should go.

## 3. What to write down

For each host and example:

- the framework preset Vercel detected
- the result of every line above: status and Location
- `__afterimageFile` from check D
- the headers from check F
- the hashes from check G, and the Pretty URLs setting
- the results of checks H and I

A line that differs from what is expected is a finding about the hosts, not a failure of the procedure. Record it, then update [deploying.md](deploying.md), and `init` if a setting has to change.

## Results

Add a row for each run, with the details above kept next to it (a pull request, an issue or a gist), and change the warning at the top of this page and of [deploying.md](deploying.md) once every example has passed on both hosts.

| Date | Afterimage version | Example | Host | Vercel preset | Checks as expected | Findings |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-01 | 0.1.0 (from npm) | next-static | Vercel | Next.js | A, B, C, D, G, H | H: the `no-null` deploy fails instead of answering 404, see check H. F: `_next/static` chunks are served with `public, max-age=0, must-revalidate`, as expected with `"framework": null`; no baseline deploy was made. |
| 2026-11-01 | 0.1.0 (from npm) | astro | Vercel | Astro | A, B, C, D, G | `/about` and `/afterimage/versions/v2/about` answer 200 with no slash. In the viewer, v2's "About this site" link opens inside the version. The example has no hashed `_astro/` files, so F had nothing to compare. `__afterimageFile` not written down. I not run. |
| 2026-11-01 | 0.1.0 (from npm) | sveltekit-static | Vercel | SvelteKit | A, B, C, E, G | The log shows `Wrote site to "build"`, and `/`, `/about` and `/afterimage/` are 200. |
| 2026-11-01 | 0.1.0 (from npm) | vite-react | Vercel | Vite | A, B, C, G | The client route `/about` answers 404 at the root. A baseline deploy without Afterimage's `vercel.json` answers 404 too: Vercel serves no single-page-app fallback for Vite by default, so this isn't Afterimage's doing. |

| 2026-11-01 | 0.1.0 (from npm) | next-static | Netlify | — | A, B, C, D, G, H | The log shows the `NETLIFY_NEXT_PLUGIN_SKIP` line. H: without it the runtime runs and `/afterimage/` is a 404. F: `_next/static` chunks are served with `public,max-age=0,must-revalidate`, Netlify's default for plain files. Node 24 by default, with no `NODE_VERSION` set. |
| 2026-11-01 | 0.1.0 (from npm) | astro | Netlify | — | A, B, C, D, G | `/about` and `/afterimage/versions/v2/about` answer 301 to the slash form. `/about.html` answers 301 to `/about/`, since Astro writes `about/index.html` and no `about.html`. In the viewer, v2's "About this site" opens inside the version, with `__afterimageFile` `/afterimage/versions/v2/about/`, as on the local static server. |
| 2026-11-01 | 0.1.0 (from npm) | sveltekit-static | Netlify | — | A, B, C, G | The log shows `Wrote site to "build"`. `/about` is 200 and `/about/` answers 301 to `/about`. |
| 2026-11-01 | 0.1.0 (from npm) | vite-react | Netlify | — | A, B, C, G | `/about` is a 404, as on Vercel. The root differs from a local build only in line endings and the bundle's hash, from building on Windows, not in links. |

In every run, on both hosts, both saved versions were served byte for byte as committed, `/afterimage` redirected to `/afterimage/` (Vercel 308, Netlify 301), and a missing path inside a version was a 404. Netlify ran with Pretty URLs on, its default, and it left the saved versions unchanged, so no `pretty_urls` setting is needed. For next-static and astro, the viewer showed both versions and stepped between them, the service worker's scope was `/afterimage/`, and on Netlify the live root had no service worker controlling it.
