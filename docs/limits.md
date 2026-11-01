# Limits

What Afterimage doesn't do, and where a version can behave differently from the app it was saved from.

## What can be saved

- **Static output only.** A version is the files a build writes, or a folder of plain HTML. Apps that render their pages on a server aren't supported: Next.js without `output: 'export'`, Astro with an adapter but without `output: 'static'`, SvelteKit without `@sveltejs/adapter-static`. `init` stops on each of these and says what to change.
- **Astro adapters with `output: 'static'`.** Read in their source, not yet tried on a build: `@astrojs/node` and `@astrojs/netlify` still write the pages to `dist/`, so the static build saves. `@astrojs/netlify` also adds a `_redirects` file to `dist/` when the site has redirects. It has no file extension, so a save stops on it until you add it to `exclude`, which leaves it out of the deployed site too. For `@astrojs/vercel`, see [deploying.md](deploying.md#astro-with-astrojsvercel).
- **Data still comes from where it came from.** A version that fetches from an API at runtime asks that API as it is today, not as it was when the version was saved.
- **Some files stop a save.** Only common web file types are saved. [commands.md](commands.md#what-a-save-keeps) has the list, and `exclude` leaves out anything else.

## Publishing

- **Every saved version is public.** Each one deploys with your site, at `/afterimage/`, to anyone who has the link. Afterimage has no command to take a version back, and saved versions are never edited, so treat a save as publishing and save only what you'd show.
- **Old code runs on your live site.** Versions are served from the same address as your live app, so an old version's code runs there with the same rights. It can register its own service worker for the whole site, and read and write the cookies, `localStorage` and IndexedDB your live app uses.
- **The root of the domain.** The history is always at `/afterimage/` on the root of the domain. A site served from a sub-path, such as a GitHub Pages project site at `you.github.io/repo/`, doesn't work.
- **Save on one branch at a time.** Versions are numbered in order, so two branches that each save make the same next number, and git can't merge them.

## Service workers

Versions load through a service worker, and browsers only run one on https or on localhost. Without it the viewer still opens, and each page keeps its own address in the version folder. Files named with relative paths, such as `style.css`, still load from the version, so plain HTML shows as saved. Files named with root paths, such as `/assets/index.js`, come from the live app, so a built app can show up unstyled, and its router can show its not-found page. The same happens on a host that doesn't serve `/afterimage/sw.js` as JavaScript.

## Browsers

The viewer has been tested in Chrome only so far. Firefox and Safari haven't been tested yet.

## Moving around inside a version

A version shows inside the viewer, and links and buttons in it stay inside that version. A few ways of leaving a page, or of loading something from it, can't be kept there, and reach the live app at the root instead:

- **Reloading the frame from the browser's menu.** Use the viewer to switch versions, or reload the whole page.
- **Back and forward after a full page load.** Going back or forward to a page the frame left with a full page load (a plain link to another HTML file), or to a page the app's router showed before you switched versions. Back and forward within one page of a single-page app work.
- **Links that open somewhere else.** `target="_blank"` opens the live app in a new tab. `target="_top"` and `target="_parent"` replace the viewer's own page with the live app.
- **Download links.**
- **Forms that send a POST.** They can't be re-sent to the version.
- **The app's own iframes.** Their pages are their own, and an empty frame the app fills in itself isn't covered.
- **Requests from the app's own Web Workers.**
- **Browsers without the Navigation API,** such as older Safari. There, only plain link clicks stay in the version. Moves made from code, such as `location.assign()`, and form submissions reach the live app.

One more falls short without reaching the live app:

- **Hosts that answer a missing file with 403 instead of 404,** such as S3 and similar object stores. Inside a version, `/about` is then not found when only `about.html` exists.

## What gets compared

- **The page the app settles on.** The viewer compares the page each version shows when it loads, after any redirect the app makes on its own, such as `/` to `/home`. Once you click or type in the frame, the page you move to isn't compared. A redirect on load to another HTML file isn't compared either.
- **An early click or key.** A click or key press in the frame before the app has finished moving on its own fixes the compared page where the app was at that moment.
- **Without the Navigation API,** such as in older Safari, a move the app makes after the page has loaded isn't followed. The page compared is the one the app showed when loading finished.
- **Saved versions only.** Changes you haven't saved yet aren't in the viewer.
- **What shows on screen.** The viewer compares the elements you can see: their text, a few attributes, their look and their position. [matching.md](matching.md) explains how it pairs them up, and why the count can differ between a phone and a desktop.
