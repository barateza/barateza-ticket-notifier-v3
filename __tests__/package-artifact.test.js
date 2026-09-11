/**
 * package-artifact.test.js
 * Guards the release artifact against silently shipping incomplete.
 *
 * Background: scripts/package.sh copied utils/ with `cp utils/*.js`, which does
 * not recurse. When the provider adapters arrived in utils/providers/, the build
 * still succeeded and the zip still looked plausible — but the three provider
 * modules were absent and the shipped extension could not resolve the poller's
 * import. Nothing in the test suite noticed, because every test imports the
 * source tree, never the packaged output.
 *
 * These tests build the artifact the way scripts/package.sh does and assert that
 * what it contains matches what the code actually imports.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function have(bin) {
  try {
    execFileSync('sh', ['-c', `command -v ${bin}`], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Do NOT skip this suite when the tools are missing.
 * A guard that silently does not run is the same failure it exists to catch: a
 * pipeline reporting success while omitting the work. Fail loudly, and say what
 * to do about it.
 */
function requireTool(bin) {
  if (!have(bin)) {
    throw new Error(
      `\`${bin}\` is required by this suite — it builds and inspects the real ` +
      `release artifact. Install it rather than letting the guard go inert ` +
      `(macOS and Linux ship it by default; on Windows use Git Bash or WSL).`
    );
  }
}

describe('packaged release artifact', () => {
    let listing;
    let zipPath;

    beforeAll(() => {
        requireTool('zip');
        requireTool('unzip');

        execFileSync('bash', ['scripts/package.sh'], { cwd: ROOT, stdio: 'pipe' });

        const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
        zipPath = path.join(ROOT, 'dist', `barateza-ticket-notifier-${version}.zip`);
        if (!fs.existsSync(zipPath)) {
            throw new Error(`scripts/package.sh did not produce ${zipPath}`);
        }

        listing = execFileSync('unzip', ['-l', zipPath], { cwd: ROOT }).toString();
    }, 60_000);

    /** Is this repo-relative path an entry in the built zip? */
    const has = (p) => listing.split('\n').some((line) => line.endsWith(` ${p}`));

    /** Every .js file under utils/, recursively, as repo-relative paths. */
    function sourceModules(dir = 'utils') {
        const out = [];
        for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
            const rel = `${dir}/${entry.name}`;
            if (entry.isDirectory()) out.push(...sourceModules(rel));
            else if (entry.name.endsWith('.js')) out.push(rel);
        }
        return out.sort();
    }

    test('ships every module under utils/, including nested directories', () => {
        const modules = sourceModules();
        expect(modules.length).toBeGreaterThan(0);

        const missing = modules.filter((m) => !has(m));
        expect(missing).toEqual([]);

        // The specific regression this test exists for.
        expect(modules).toEqual(expect.arrayContaining([
            'utils/providers/provider-registry.js',
            'utils/providers/zendesk-provider.js',
            'utils/providers/jira-provider.js'
        ]));
    });

    test('resolves every relative import from shipped files inside the artifact', () => {
        const entries = [
            'background.js', 'popup.js', 'offscreen.js',
            ...fs.readdirSync(ROOT).filter((f) => f.startsWith('popup-') && f.endsWith('.js')),
            ...sourceModules()
        ];

        const specifiers = new Set();
        for (const file of entries) {
            const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
            for (const m of src.matchAll(/from\s+'\.\/([^']+)'/g)) {
                specifiers.add(m[1]);
            }
        }
        expect(specifiers.size).toBeGreaterThan(0);

        // Specifiers are relative to their importer, so match on path suffix:
        // "providers/registry.js" from utils/poller.js is utils/providers/registry.js.
        const unresolved = [...specifiers].filter(
            (s) => !listing.split('\n').some((line) => line.endsWith(`/${s}`) || line.endsWith(` ${s}`))
        );
        expect(unresolved).toEqual([]);
    });

    test('does not resurrect the removed duplicate module', () => {
        expect(has('utils/endpoint-io.js')).toBe(false);
    });

    test('ships no test files', () => {
        // package.sh copies every .js under utils/, so a co-located test would be
        // published verbatim. Assert none leaked in.
        const shipped = listing.split('\n').filter((line) => /\.test\.js\s*$/.test(line));
        expect(shipped).toEqual([]);
    });

    test('artifact version matches package.json', () => {
        const inArtifact = JSON.parse(
            execFileSync('unzip', ['-p', zipPath, 'manifest.json'], { cwd: ROOT }).toString()
        ).version;
        const inPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

        expect(inArtifact).toBe(inPackage);
    });
});
