import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli/main.js';
import { readConfig } from '../src/cli/config.js';

async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'afterimage-test-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('afterimage-test-'));
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

// answers lists what the terminal would reply, in order; without it the run has no TTY. questions collects what was asked.
async function run(cwd, args = [], { answers } = {}) {
  const out = [];
  const err = [];
  const questions = [];
  const ctx = { cwd, stdout: { write: text => out.push(text) }, stderr: { write: text => err.push(text) }, isTTY: Boolean(answers) };
  if (answers) {
    ctx.ask = async question => {
      questions.push(question);
      return answers.shift() ?? '';
    };
  }
  const code = await main(['init', ...args], ctx);
  return { code, stdout: out.join(''), stderr: err.join(''), questions };
}

const write = (root, name, text) => fs.writeFile(path.join(root, name), text);
const read = (root, name) => fs.readFile(path.join(root, name), 'utf8');
const readJson = async (root, name) => JSON.parse(await read(root, name));
const exists = async (root, name) => fs.stat(path.join(root, name)).then(() => true, () => false);

// Every file in the project with its bytes, so a second run can be compared byte for byte.
async function snapshot(root) {
  const files = {};
  for (const name of (await fs.readdir(root, { recursive: true })).sort()) {
    const stat = await fs.stat(path.join(root, name));
    if (stat.isFile()) files[name] = await fs.readFile(path.join(root, name));
  }
  return files;
}

const hostBuild = 'npm run afterimage:build';
const hostOutput = '.afterimage/site';
// What init asks of Vercel for clean URLs on the live app: a rewrite that leaves /afterimage/ out, never cleanUrls.
const cleanUrlRewrite = { source: '/:path((?!afterimage/|afterimage$).+)', destination: '/:path*.html' };
// And the slash on /afterimage, which Vercel otherwise answers with the viewer's page and no redirect.
const slashRedirect = { source: '/afterimage', destination: '/afterimage/' };
const lines = text => text.split(/\r?\n/);

test('init in a plain folder creates package.json and ignores node_modules', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);

  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: '.', build: null, type: 'plain' });
  assert.deepEqual(await readJson(root, 'package.json'), {
    private: true,
    scripts: { 'afterimage:save': 'afterimage save', 'afterimage:dev': 'afterimage dev', 'afterimage:build': 'afterimage build' }
  });
  assert.deepEqual(lines(await read(root, '.gitignore')).filter(Boolean), ['.afterimage/', 'node_modules/']);
  assert.deepEqual(lines(await read(root, '.gitattributes')).filter(Boolean), ['afterimage/** -text']);
  assert.match(result.stdout, /^Created afterimage\.config\.json/m);
  assert.match(result.stdout, /^Created package\.json \(added 3 scripts\)$/m);
  assert.match(result.stdout, /^Created \.gitignore$/m);
  assert.match(result.stdout, /^Created \.gitattributes$/m);
  assert.match(result.stdout, /^Created vercel\.json$/m);
  assert.match(result.stdout, /^Created netlify\.toml$/m);
  assert.ok(result.stdout.trimEnd().endsWith('Next: npx afterimage save "First version"'));
});

test('init reads the project before it creates package.json', async t => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, 'site'));
  await write(root, 'site/index.html', '<h1>Hi</h1>');
  assert.equal((await run(root)).code, 0);
  assert.equal((await readConfig(root)).source, 'site');
});

test('init in a vite project saves its build output', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ name: 'demo', scripts: { build: 'vite build' }, devDependencies: { vite: '1.0.0' } }, null, 2) + '\n');
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: 'dist', build: 'npm run build', type: 'vite' });
  const manifest = await readJson(root, 'package.json');
  assert.equal(manifest.name, 'demo');
  assert.equal(manifest.scripts.build, 'vite build');
  assert.equal(manifest.scripts['afterimage:build'], 'afterimage build');
  assert.match(result.stdout, /^Updated package\.json \(added 3 scripts\)$/m);
});

test('package.json keeps its scripts and only gets the ones it lacks', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'package.json', '{\n\t"devDependencies": { "vite": "1.0.0" },\n\t"scripts": {\n\t\t"afterimage:save": "my own save"\n\t}\n}\n');
  const result = await run(root);
  assert.match(result.stdout, /^Updated package\.json \(added 2 scripts\)$/m);
  const text = await read(root, 'package.json');
  assert.match(text, /^\t"scripts"/m, 'keeps the tab indent');
  const manifest = JSON.parse(text);
  assert.equal(manifest.scripts['afterimage:save'], 'my own save');
  assert.equal(manifest.scripts['afterimage:dev'], 'afterimage dev');
  assert.equal(manifest.scripts['afterimage:build'], 'afterimage build');
});

test('a different afterimage:build script is kept and called out', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '1.0.0' }, scripts: { 'afterimage:build': 'echo nope' } }));
  const result = await run(root);
  assert.equal((await readJson(root, 'package.json')).scripts['afterimage:build'], 'echo nope');
  assert.match(result.stdout, /already has "afterimage:build": "echo nope"/);
});

test('git files are appended without duplicating lines, in their own line ending', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, '.gitignore', 'dist\r\n/node_modules\r\n');
  await write(root, '.gitattributes', '* text=auto\nafterimage/** -text -diff');
  const result = await run(root);
  assert.equal(await read(root, '.gitignore'), 'dist\r\n/node_modules\r\n.afterimage/\r\n');
  assert.equal(await read(root, '.gitattributes'), '* text=auto\nafterimage/** -text -diff');
  assert.match(result.stdout, /^Updated \.gitignore \(added \.afterimage\/\)$/m);
  assert.doesNotMatch(result.stdout, /\.gitattributes/);
});

test('git attributes get a new line after a file with no final newline', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, '.gitattributes', '* text=auto');
  await run(root);
  assert.equal(await read(root, '.gitattributes'), '* text=auto\nafterimage/** -text\n');
});

test('init writes vercel.json and netlify.toml with the host build and output', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await run(root);
  assert.deepEqual(await readJson(root, 'vercel.json'), { buildCommand: hostBuild, outputDirectory: hostOutput, rewrites: [cleanUrlRewrite], redirects: [slashRedirect] });
  assert.match(await read(root, 'vercel.json'), /^\{\n {2}"buildCommand": /);
  assert.equal(await read(root, 'netlify.toml'), `[build]\n  command = "${hostBuild}"\n  publish = "${hostOutput}"\n`);
});

const nextProject = async root => {
  await write(root, 'package.json', JSON.stringify({ dependencies: { next: '15.0.0' } }));
  await write(root, 'next.config.mjs', "export default { output: 'export' };\n");
};

// Vercel detects the framework from package.json, and Next.js's own builder serves the export's folder (out/) instead of
// outputDirectory, so a project that depends on next needs "framework": null. Other presets honour outputDirectory and
// would lose cache headers or a SPA fallback to null, so they keep theirs. The rewrite is how the live app keeps clean
// URLs without the Next builder, and the redirect puts the slash on /afterimage. None of them touches /afterimage/'s files.
test('vercel.json of a Next.js project asks for no framework', async t => {
  const root = await temp(t);
  await nextProject(root);
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(await readJson(root, 'vercel.json'), { framework: null, buildCommand: hostBuild, outputDirectory: hostOutput, rewrites: [cleanUrlRewrite], redirects: [slashRedirect] });
  assert.match(await read(root, 'vercel.json'), /^\{\n {2}"framework": null,\n {2}"buildCommand": /);
  assert.match(result.stdout, /^Created vercel\.json$/m);
});

test('vercel.json of other projects names no framework, whatever the project uses', async t => {
  for (const dependencies of [{ vite: '1.0.0' }, { astro: '5.0.0' }, { '@sveltejs/kit': '2.0.0', '@sveltejs/adapter-static': '3.0.0' }]) {
    const root = await temp(t);
    await write(root, 'package.json', JSON.stringify({ devDependencies: dependencies }));
    await write(root, 'index.html', '<h1>Hi</h1>');
    await run(root, ['--source', '.']);
    assert.equal(Object.hasOwn(await readJson(root, 'vercel.json'), 'framework'), false, Object.keys(dependencies)[0]);
  }
});

test('a framework another project names is not touched or asked about', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '1.0.0' } }));
  await write(root, 'vercel.json', JSON.stringify({ framework: 'vite' }));
  const result = await run(root, [], { answers: [] });
  assert.deepEqual(result.questions, []);
  assert.equal((await readJson(root, 'vercel.json')).framework, 'vite');
});

test('the clean-URL rewrite matches every page and leaves /afterimage/ out', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await run(root);
  const [rewrite] = (await readJson(root, 'vercel.json')).rewrites;
  const source = new RegExp(`^/(${/^\/:path\((.+)\)$/.exec(rewrite.source)[1]})$`);
  assert.equal(rewrite.destination, '/:path*.html');
  for (const path of ['/about', '/blog/post-1', '/afterimages', '/about/afterimage']) assert.ok(source.test(path), `${path} should be rewritten`);
  for (const path of ['/afterimage', '/afterimage/', '/afterimage/versions/v1/about', '/afterimage/index.html']) assert.ok(!source.test(path), `${path} must not be rewritten`);
  assert.equal((await readJson(root, 'vercel.json')).cleanUrls, undefined, 'cleanUrls would redirect the history\'s own pages');
});

test('a project\'s own rewrites and redirects keep their order and ours go last, once', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const own = { source: '/old', destination: '/new' };
  const ownRedirect = { source: '/a', destination: '/b' };
  await write(root, 'vercel.json', JSON.stringify({ rewrites: [own], redirects: [ownRedirect] }));
  const result = await run(root);
  const settings = await readJson(root, 'vercel.json');
  assert.deepEqual(settings.rewrites, [own, cleanUrlRewrite]);
  assert.deepEqual(settings.redirects, [ownRedirect, slashRedirect]);
  assert.match(result.stdout, /^Updated vercel\.json \(set buildCommand, outputDirectory, rewrites, redirects\)$/m);
  const before = await snapshot(root);
  assert.match((await run(root)).stdout, /already set up/);
  assert.deepEqual(await snapshot(root), before);
});

test('our rewrite and redirect in another spelling are recognised and not added again', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const rewrites = [{ source: '/:path((?!afterimage(?:/|$)).*)', destination: '/:path.html' }];
  const redirects = [{ source: '/afterimage/', destination: '/afterimage/', permanent: false }];
  await write(root, 'vercel.json', JSON.stringify({ buildCommand: hostBuild, outputDirectory: hostOutput, rewrites, redirects }));
  const original = await read(root, 'vercel.json');
  const result = await run(root);
  assert.equal(await read(root, 'vercel.json'), original);
  assert.doesNotMatch(result.stdout, /vercel\.json/);
});

test('only the missing vercel.json keys are named as set', async t => {
  const root = await temp(t);
  await nextProject(root);
  await write(root, 'vercel.json', JSON.stringify({ framework: null, buildCommand: hostBuild, outputDirectory: hostOutput, redirects: [slashRedirect] }));
  assert.match((await run(root)).stdout, /^Updated vercel\.json \(set rewrites\)$/m);
});

test('cleanUrls: true is left alone and called out, since it takes the history\'s pages out of their folder', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'vercel.json', JSON.stringify({ cleanUrls: true }));
  const result = await run(root);
  const settings = await readJson(root, 'vercel.json');
  assert.equal(settings.cleanUrls, true);
  assert.equal(settings.rewrites, undefined, 'no rewrite is needed next to cleanUrls');
  assert.match(result.stdout, /"cleanUrls": true\. It also redirects the history's own pages/);
  const again = await run(root);
  assert.match(again.stdout, /^No files changed\. Still left for you:$/m);
  assert.match(again.stdout, /"cleanUrls": true/);
});

for (const value of [true, false]) {
  test(`trailingSlash: ${value} is left alone and called out, and nothing else is added that depends on it`, async t => {
    const root = await temp(t);
    await write(root, 'index.html', '<h1>Hi</h1>');
    await write(root, 'vercel.json', JSON.stringify({ trailingSlash: value }));
    const result = await run(root);
    const settings = await readJson(root, 'vercel.json');
    assert.equal(settings.trailingSlash, value);
    // A redirect to the slash form would loop with trailingSlash: false, and a rewrite is pointless next to either.
    assert.equal(settings.rewrites, undefined);
    assert.equal(settings.redirects, undefined);
    assert.match(result.stdout, new RegExp(`"trailingSlash": ${value}\\. It redirects paths under /afterimage/`));
    assert.match(result.stdout, /the history will not open/);
    const again = await run(root);
    assert.match(again.stdout, /^No files changed\. Still left for you:$/m);
    assert.match(again.stdout, /"trailingSlash"/);
  });
}

test('rewrites and redirects that are not a list are left alone and the rest is still set', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'vercel.json', JSON.stringify({ rewrites: 'nope', redirects: { a: 1 } }));
  const result = await run(root);
  const settings = await readJson(root, 'vercel.json');
  assert.equal(settings.rewrites, 'nope');
  assert.deepEqual(settings.redirects, { a: 1 });
  assert.equal(settings.buildCommand, hostBuild);
  assert.match(result.stdout, /"rewrites" is not a list/);
  assert.match(result.stdout, /"redirects" is not a list/);
  assert.match(result.stdout, /^Updated vercel\.json \(set buildCommand, outputDirectory\)$/m);
});

const frameworkQuestion = "vercel.json uses the nextjs framework preset, which can serve its own build instead of the history. Switch to Afterimage's settings? (y/N)";

test('a named framework in a Next.js project is switched to none only after the user says yes', async t => {
  const root = await temp(t);
  await nextProject(root);
  const original = JSON.stringify({ framework: 'nextjs', buildCommand: hostBuild, outputDirectory: hostOutput }, null, 2) + '\n';
  await write(root, 'vercel.json', original);

  const declined = await run(root, [], { answers: ['n'] });
  assert.deepEqual(declined.questions, [frameworkQuestion]);
  assert.equal(await read(root, 'vercel.json'), original);
  assert.ok(declined.stdout.includes('"framework": null'));

  const agreed = await run(root, [], { answers: ['y'] });
  assert.equal(agreed.questions.length, 1);
  assert.deepEqual(await readJson(root, 'vercel.json'), { framework: null, buildCommand: hostBuild, outputDirectory: hostOutput, rewrites: [cleanUrlRewrite], redirects: [slashRedirect] });
  assert.match(agreed.stdout, /^Updated vercel\.json \(set framework, rewrites, redirects\)$/m);
});

test('a named framework is left alone without a TTY, and the printed values say what to set and what to add', async t => {
  const root = await temp(t);
  await nextProject(root);
  const original = JSON.stringify({ framework: 'nextjs', buildCommand: hostBuild, outputDirectory: hostOutput, rewrites: [{ source: '/old', destination: '/new' }] }) + '\n';
  await write(root, 'vercel.json', original);
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await read(root, 'vercel.json'), original);
  assert.match(result.stdout, /Left vercel\.json as it is/);
  assert.ok(result.stdout.includes('"framework": null'));
  // Pasting must never replace the project's own rules, so lists are asked to be added to.
  assert.match(result.stdout, /and add this to "rewrites", keeping the rules already there:\n\{\n {2}"source": "\/:path/);
  assert.match(result.stdout, /and add this to "redirects", keeping the rules already there:\n\{\n {2}"source": "\/afterimage"/);
  assert.doesNotMatch(result.stdout, /set:\n[^]*"rewrites": \[/);
  assert.doesNotMatch(result.stdout, /already set up/);
});

test('a named framework next to a different build is one question about both', async t => {
  const root = await temp(t);
  await nextProject(root);
  await write(root, 'vercel.json', JSON.stringify({ framework: 'nextjs', buildCommand: 'npm run build', outputDirectory: 'out' }));
  const result = await run(root, [], { answers: ['n'] });
  assert.deepEqual(result.questions, ["vercel.json builds with npm run build, serves out, uses the nextjs framework preset, which can serve its own build instead of the history. Switch to Afterimage's settings? (y/N)"]);
});

// Netlify's Next.js runtime deploys a static export's own folder (out/) in place of the publish directory, so a project
// that depends on next tells it to step aside. Other projects do not get the variable.
test('netlify.toml of a Next.js project turns the Next.js runtime off, whatever type init chose', async t => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, 'static'));
  await write(root, 'package.json', JSON.stringify({ dependencies: { next: '15.0.0' } }));
  await write(root, 'next.config.mjs', 'export default {};\n');
  const result = await run(root, ['--source', 'static']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readConfig(root)).type, 'plain');
  assert.equal(await read(root, 'netlify.toml'), `[build]\n  command = "${hostBuild}"\n  publish = "${hostOutput}"\n\n[build.environment]\n  NETLIFY_NEXT_PLUGIN_SKIP = "true"\n`);
});

test('netlify.toml of other projects has no Next.js setting', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '1.0.0' } }));
  await run(root);
  assert.doesNotMatch(await read(root, 'netlify.toml'), /NEXT/);
});

test('an existing netlify.toml of a Next.js project is told about the runtime setting, and is quiet once it has it', async t => {
  const root = await temp(t);
  await nextProject(root);
  const original = `[build]\n  command = "${hostBuild}"\n  publish = "${hostOutput}"\n`;
  await write(root, 'netlify.toml', original);
  const result = await run(root);
  assert.equal(await read(root, 'netlify.toml'), original);
  assert.match(result.stdout, /Under \[build\.environment\], set .*:\n {2}NETLIFY_NEXT_PLUGIN_SKIP = "true"/);
  assert.doesNotMatch(result.stdout, /Under \[build\], set/);

  await write(root, 'netlify.toml', `${original}\n[build.environment]\n  NETLIFY_NEXT_PLUGIN_SKIP = "true"\n`);
  assert.doesNotMatch((await run(root)).stdout, /netlify/);
});

test('Astro with the Vercel adapter has no static build unless the config says output: static', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ dependencies: { astro: '5.0.0', '@astrojs/vercel': '8.0.0' } }));
  await write(root, 'astro.config.mjs', "import vercel from '@astrojs/vercel';\nexport default { output: 'server', adapter: vercel() };\n");
  const before = await snapshot(root);
  const result = await run(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /@astrojs\/vercel, a server adapter/);
  assert.match(result.stderr, /output: 'static' in the astro config/);
  assert.deepEqual(await snapshot(root), before);

  await write(root, 'astro.config.mjs', "import vercel from '@astrojs/vercel';\nexport default { output: 'static', adapter: vercel() };\n");
  assert.equal((await run(root)).code, 0);
  assert.equal((await readConfig(root)).source, 'dist');
});

test('an existing vercel.json keeps its other keys', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'vercel.json', JSON.stringify({ cleanUrls: true, headers: [{ source: '/(.*)', headers: [] }] }, null, 4));
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  const text = await read(root, 'vercel.json');
  assert.deepEqual(JSON.parse(text), {
    cleanUrls: true,
    headers: [{ source: '/(.*)', headers: [] }],
    buildCommand: hostBuild,
    outputDirectory: hostOutput,
    redirects: [slashRedirect]
  });
  assert.ok(text.endsWith('}\n'));
  assert.match(text, /^ {2}"cleanUrls"/m, 'writes 2-space JSON');
  assert.match(result.stdout, /^Updated vercel\.json \(set buildCommand, outputDirectory, redirects\)$/m);
});

test('a different vercel.json build is switched only after the user says yes', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const original = JSON.stringify({ buildCommand: 'npm run build', outputDirectory: 'dist', framework: null }, null, 2) + '\n';
  await write(root, 'vercel.json', original);

  const declined = await run(root, [], { answers: ['n'] });
  assert.deepEqual(declined.questions, ["vercel.json builds with npm run build and serves dist. Switch both to Afterimage's? (y/N)"]);
  assert.equal(await read(root, 'vercel.json'), original);
  assert.match(declined.stdout, /Left vercel\.json as it is/);

  const agreed = await run(root, [], { answers: ['y'] });
  assert.equal(agreed.questions.length, 1);
  assert.deepEqual(await readJson(root, 'vercel.json'), { buildCommand: hostBuild, outputDirectory: hostOutput, framework: null, rewrites: [cleanUrlRewrite], redirects: [slashRedirect] });
  assert.match(agreed.stdout, /^Updated vercel\.json/m);
});

test('a different vercel.json build is left alone without a TTY and says what to set', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const original = JSON.stringify({ buildCommand: 'npm run build' }) + '\n';
  await write(root, 'vercel.json', original);
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await read(root, 'vercel.json'), original);
  assert.match(result.stdout, /Left vercel\.json as it is/);
  assert.ok(result.stdout.includes(`"buildCommand": "${hostBuild}"`));
  assert.ok(result.stdout.includes(`"outputDirectory": "${hostOutput}"`));
  assert.doesNotMatch(result.stdout, /already set up/);
});

test('a vercel.json that is not JSON stops init before anything is written', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'vercel.json', '{ nope');
  const before = await snapshot(root);
  const result = await run(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /vercel\.json is not valid JSON/);
  assert.deepEqual(await snapshot(root), before);
});

// --source skips the unknown stop, so only the package.json check can fail these runs.
for (const [title, packageText, message] of [
  ['is not JSON', '{ nope', /package\.json is not valid JSON/],
  ['is not an object', '[]', /package\.json must be a JSON object/],
  ['has scripts that are not an object', JSON.stringify({ scripts: 'nope' }), /"scripts" must be an object/]
]) {
  test(`a package.json that ${title} stops init before anything is written`, async t => {
    const root = await temp(t);
    await fs.mkdir(path.join(root, 'site'));
    await write(root, 'package.json', packageText);
    const before = await snapshot(root);
    const result = await run(root, ['--source', 'site']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, message);
    assert.deepEqual(await snapshot(root), before);
  });
}

test('a bad package.json stops init before it asks anything', async t => {
  const root = await temp(t);
  await write(root, 'package.json', '{ nope');
  const result = await run(root, [], { answers: ['site'] });
  assert.equal(result.code, 1);
  assert.deepEqual(result.questions, []);
});

test('an existing netlify.toml is never rewritten', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const original = '[build]\n  command = "npm run build"\n  publish = "dist"\n\n[[redirects]]\n  from = "/a"\n  to = "/b"\n';
  await write(root, 'netlify.toml', original);
  const result = await run(root);
  assert.equal(await read(root, 'netlify.toml'), original);
  assert.match(result.stdout, /netlify\.toml already exists/);
  assert.ok(result.stdout.includes(`command = "${hostBuild}"`));
  assert.ok(result.stdout.includes(`publish = "${hostOutput}"`));
});

test('a netlify.toml that already has both values is left quiet', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'netlify.toml', `[build]\n  command = "${hostBuild}"\n  publish = "${hostOutput}"\n`);
  const result = await run(root);
  assert.doesNotMatch(result.stdout, /netlify/);
});

test('init twice is a no-op', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  assert.equal((await run(root)).code, 0);
  const before = await snapshot(root);
  const second = await run(root);
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(await snapshot(root), before);
  assert.match(second.stdout, /^Everything is already set up\. Nothing changed\.$/m);
  assert.doesNotMatch(second.stdout, /^(Created|Updated)/m);
});

test('init twice is a no-op in a framework project too', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '1.0.0' } }, null, 2) + '\n');
  assert.equal((await run(root)).code, 0);
  const before = await snapshot(root);
  const second = await run(root);
  assert.deepEqual(await snapshot(root), before);
  assert.match(second.stdout, /already set up/);
});

test('init after a hand edit to the config keeps the edit', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await run(root);
  const config = await readJson(root, 'afterimage.config.json');
  await write(root, 'afterimage.config.json', JSON.stringify({ ...config, exclude: ['drafts'] }, null, 2) + '\n');
  const before = await snapshot(root);
  assert.equal((await run(root)).code, 0);
  assert.deepEqual(await snapshot(root), before);
});

test('--source and --build override detection', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const result = await run(root, ['--source', 'public/', '--build', 'node make.js']);
  assert.equal(result.code, 0, result.stderr);
  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: 'public', build: 'node make.js', type: 'unknown' });
});

test('--source naming the detected folder keeps the detected type and build', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ devDependencies: { vite: '1.0.0' } }));
  await run(root, ['--source', './dist']);
  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: 'dist', build: 'npm run build', type: 'vite' });
});

test('--source without a build needs the folder to exist', async t => {
  const root = await temp(t);
  const result = await run(root, ['--source', 'nowhere']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /nowhere does not exist yet\. If a build creates it/);
  assert.equal(await exists(root, 'afterimage.config.json'), false);
});

test('--source outside the project is refused', async t => {
  const root = await temp(t);
  const result = await run(root, ['--source', '..']);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /outside this project/);
});

test('flags on an existing config update it', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await run(root);
  const result = await run(root, ['--build', 'node make.js']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readConfig(root)).build, 'node make.js');
  assert.match(result.stdout, /^Updated afterimage\.config\.json/m);
});

test('unknown project without a TTY asks for --source', async t => {
  const root = await temp(t);
  const result = await run(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /afterimage init --source <folder>/);
  assert.match(result.stderr, /--build "<command>"/);
  assert.deepEqual(Object.keys(await snapshot(root)), []);
});

test('unknown project in a TTY asks one question and uses the answer', async t => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, 'out'));
  const result = await run(root, [], { answers: ['out'] });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.questions, ['Which folder holds your prototype, or which folder does your build write to?']);
  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: 'out', build: null, type: 'plain' });
});

test('an empty answer stops without writing anything', async t => {
  const root = await temp(t);
  const result = await run(root, [], { answers: [''] });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /afterimage init --source <folder>/);
  assert.deepEqual(Object.keys(await snapshot(root)), []);
});

test('next without static export stops and names output: export', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ dependencies: { next: '15.0.0' } }));
  await write(root, 'next.config.mjs', 'export default {};\n');
  const before = await snapshot(root);
  const result = await run(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /output: 'export'/);
  assert.deepEqual(await snapshot(root), before);
});

test('next with static export is set up to save out/', async t => {
  const root = await temp(t);
  await write(root, 'package.json', JSON.stringify({ dependencies: { next: '15.0.0' } }));
  await write(root, 'next.config.mjs', "export default { output: 'export' };\n");
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readConfig(root)).source, 'out');
});

test('an unknown flag is a usage error', async t => {
  const root = await temp(t);
  const result = await run(root, ['--nope']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Usage: afterimage init/);
});

test('both vercel.json values differing are named in one question', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'vercel.json', JSON.stringify({ buildCommand: 'npm run build', outputDirectory: 'dist' }));
  const result = await run(root, [], { answers: ['n'] });
  assert.match(result.questions[0], /builds with npm run build and serves dist/);
});

test('only outputDirectory differing asks about the output', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'vercel.json', JSON.stringify({ outputDirectory: 'dist' }));
  const result = await run(root, [], { answers: ['n'] });
  assert.deepEqual(result.questions, ["vercel.json already serves dist. Switch it to Afterimage's output? (y/N)"]);
});

test('a closed terminal answers no to the vercel question and still reports', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  const original = JSON.stringify({ buildCommand: 'npm run build' }) + '\n';
  await write(root, 'vercel.json', original);
  const result = await run(root, [], { answers: [] });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await read(root, 'vercel.json'), original);
  assert.match(result.stdout, /^Created afterimage\.config\.json/m);
  assert.match(result.stdout, /Left vercel\.json as it is/);
});

test('a second run after a declined vercel.json does not claim everything is set up', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'vercel.json', JSON.stringify({ buildCommand: 'npm run build' }) + '\n');
  assert.equal((await run(root)).code, 0);
  const before = await snapshot(root);
  const second = await run(root);
  assert.equal(second.code, 0, second.stderr);
  assert.deepEqual(await snapshot(root), before);
  assert.doesNotMatch(second.stdout, /already set up/);
  assert.match(second.stdout, /^No files changed\. Still left for you:$/m);
  assert.match(second.stdout, /Left vercel\.json as it is/);
});

test('a second run with an unmatched netlify.toml does not claim everything is set up', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'netlify.toml', '[build]\n  command = "npm run build"\n');
  await run(root);
  const second = await run(root);
  assert.doesNotMatch(second.stdout, /already set up/);
  assert.match(second.stdout, /netlify\.toml already exists/);
});

test('an answered folder that does not exist yet says a build can create it', async t => {
  const root = await temp(t);
  const result = await run(root, [], { answers: ['dist'] });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /dist does not exist yet\. If a build creates it, run init again with --build/);
  assert.doesNotMatch(result.stderr, /Pass the folder/);
  assert.deepEqual(Object.keys(await snapshot(root)), []);
});

test('a byte order mark in package.json is read and kept', async t => {
  const root = await temp(t);
  await write(root, 'package.json', '﻿' + JSON.stringify({ devDependencies: { vite: '1.0.0' } }, null, 2) + '\n');
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  assert.equal((await readConfig(root)).type, 'vite');
  const text = await read(root, 'package.json');
  assert.ok(text.startsWith('﻿{'));
  assert.equal(JSON.parse(text.slice(1)).scripts['afterimage:build'], 'afterimage build');
  const before = await snapshot(root);
  await run(root);
  assert.deepEqual(await snapshot(root), before);
});

test('a byte order mark in vercel.json is read and kept', async t => {
  const root = await temp(t);
  await write(root, 'index.html', '<h1>Hi</h1>');
  await write(root, 'vercel.json', '﻿{"cleanUrls": true}');
  const result = await run(root);
  assert.equal(result.code, 0, result.stderr);
  const text = await read(root, 'vercel.json');
  assert.ok(text.startsWith('﻿{'));
  assert.deepEqual(JSON.parse(text.slice(1)), { cleanUrls: true, buildCommand: hostBuild, outputDirectory: hostOutput, redirects: [slashRedirect] });
});

test('a CRLF package.json keeps its line endings and a second run changes nothing', async t => {
  const root = await temp(t);
  await write(root, 'package.json', '{\r\n  "devDependencies": { "vite": "1.0.0" }\r\n}\r\n');
  assert.equal((await run(root)).code, 0);
  const text = await read(root, 'package.json');
  assert.ok(!/(^|[^\r])\n/.test(text), 'every newline is CRLF');
  assert.ok(text.endsWith('}\r\n'));
  assert.equal(JSON.parse(text).scripts['afterimage:save'], 'afterimage save');
  const before = await snapshot(root);
  await run(root);
  assert.deepEqual(await snapshot(root), before);
});

test('a 4-space package.json with no final newline keeps both', async t => {
  const root = await temp(t);
  await write(root, 'package.json', '{\n    "devDependencies": { "vite": "1.0.0" }\n}');
  assert.equal((await run(root)).code, 0);
  const text = await read(root, 'package.json');
  assert.match(text, /^ {4}"scripts": \{$/m);
  assert.match(text, /^ {8}"afterimage:save"/m);
  assert.ok(text.endsWith('}'));
  assert.equal(JSON.parse(text).scripts['afterimage:build'], 'afterimage build');
});

test('next with a server and --source, without a TTY, uses the folder given', async t => {
  const root = await temp(t);
  await fs.mkdir(path.join(root, 'static'));
  await write(root, 'package.json', JSON.stringify({ dependencies: { next: '15.0.0' } }));
  await write(root, 'next.config.mjs', 'export default {};\n');
  const result = await run(root, ['--source', 'static']);
  assert.equal(result.code, 0, result.stderr);
  const config = await readConfig(root);
  assert.deepEqual({ source: config.source, build: config.build, type: config.type }, { source: 'static', build: null, type: 'plain' });
});

// A cancelled prompt (Ctrl-C) rejects with Node's abort code; ask can be told to do that at the Nth question.
for (const [title, setup, args] of [
  ['the folder question', async root => root, []],
  ['the vercel.json question', async root => { await write(root, 'index.html', '<h1>Hi</h1>'); await write(root, 'vercel.json', JSON.stringify({ buildCommand: 'npm run build' })); }, []]
]) {
  test(`Ctrl-C at ${title} stops with exit 130 and writes nothing`, async t => {
    const root = await temp(t);
    await setup(root);
    const before = await snapshot(root);
    const out = [];
    const err = [];
    const code = await main(['init', ...args], {
      cwd: root,
      stdout: { write: text => out.push(text) },
      stderr: { write: text => err.push(text) },
      isTTY: true,
      ask: async () => { throw Object.assign(new Error('Prompt cancelled.'), { code: 'ABORT_ERR' }); }
    });
    assert.equal(code, 130);
    assert.equal(err.join(''), 'Stopped. Nothing was changed.\n');
    assert.equal(out.join(''), '');
    assert.deepEqual(await snapshot(root), before);
  });
}
