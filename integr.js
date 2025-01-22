const fs = require("node:fs");
const path = require("node:path");
const { exec: cbexec, execSync } = require("node:child_process");
const { promisify } = require("node:util");

const pexec = promisify(cbexec);

const WORK_DIR = "work";

// prettier-ignore
const REPO_MAP = {
  curves: { url: 'https://github.com/paulmillr/noble-curves', package: '@noble-curves' },
  hashes: { url: 'https://github.com/paulmillr/noble-hashes', package: '@noble/hashes' },
  ciphers: { url: 'https://github.com/paulmillr/noble-ciphers', package: '@noble/ciphers' },
  // pqc: { url: 'https://github.com/paulmillr/noble-post-quantum', package: '@noble/post-quantum' },
  starknet: { url: 'https://github.com/paulmillr/scure-starknet', package: '@scure/starknet' },
  // btc: { url: 'https://github.com/paulmillr/scure-btc-signer', package: '@scure/btc-signer' },
  // bip39: { url: 'https://github.com/paulmillr/scure-bip39', package: '@scure/bip39' },
  // bip32: { url: 'https://github.com/paulmillr/scure-bip32', package: '@scure/bip32' },
  // base: { url: 'https://github.com/paulmillr/scure-base', package: '@scure/base' },
  // ordinals: { url: 'https://github.com/paulmillr/micro-ordinals', package: 'micro-ordinals' },
  // sol: { url: 'https://github.com/paulmillr/micro-sol-signer', package: 'micro-sol-signer' },
  // eth: { url: 'https://github.com/paulmillr/micro-eth-signer', package: 'micro-eth-signer' },
  // rsa: { url: 'https://github.com/paulmillr/micro-rsa-dsa-dh', package: 'micro-rsa-dsa-dh' },
  keygen: { url: 'https://github.com/paulmillr/micro-key-producer', package: 'micro-key-producer' },
  // qr: { url: 'https://github.com/paulmillr/qr', package: '@paulmillr/qr' },
  // packed: { url: 'https://github.com/paulmillr/micro-packed', package: 'micro-packed' },
  // No build step
  // should: { url: 'https://github.com/paulmillr/micro-should', package: 'micro-should' },
  // bmark: { url: 'https://github.com/paulmillr/micro-bmark', package: 'micro-bmark' },
};

// String formatting utils
const _c = String.fromCharCode(27); // x1b, control code for terminal colors
const c = {
  // colors
  red: _c + "[31m",
  green: _c + "[32m",
  yellow: _c + "[33m",
  cyan: _c + "[36m",
  gray: _c + "[1;30m",
  reset: _c + "[0m",
};

// Utils
const sanitizeName = (name) => name.toLowerCase().replace(/\s+/g, "_");
const read = (filePath) => fs.readFileSync(filePath, "utf8");
const write = (filePath, content = "") => {
  console.log("# write", filePath, content.length);
  const tmpPath = `${filePath}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
};
const formatDuration = (ms) => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

const LOGS = [];

function writeLog(repoName, stdout, stderr) {
  LOGS.push({ repoName, stdout, stderr });
}

function termLog(msg) {
  console.log(`${c.cyan}${msg}${c.reset}`);
}

function chdir(newer) {
  const p = path.join(process.cwd(), newer);
  termLog(`chdir ${newer}`);
  process.chdir(p);
}

// Actions
async function exec(repoName, cmd) {
  // if (repoName) chdir(repoName);
  if (repoName) console.log(`# in ${repoName}`);
  termLog(`${c.cyan}${cmd}${c.reset}`);
  const { stdout, stderr } = await pexec(cmd, {
    encoding: "utf8",
    cwd: repoName ? path.join(process.cwd(), repoName) : undefined,
    env: { ...process.env, MSHOULD_QUIET: 1, MSHOULD_FAST: 1 },
  });
  writeLog(repoName, stdout, stderr);
  // if (repoName) chdir("..");
}

function rm(dir) {
  termLog(`rm -rf ${dir}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

function mkdirp(dir) {
  termLog(`mkdir -p ${dir}`);
  fs.mkdirSync(dir, { recursive: true });
}

async function gitClone(repoName, repoUrl, branch) {
  // rm(repoName);
  await exec(
    undefined,
    `git clone ${
      branch ? `-b ${branch}` : ""
    } --recursive --depth 2 "${repoUrl}" "${repoName}"`
  );
  return;
}

function replaceDeps(dir, deps) {
  chdir(dir);
  const cwd = dir;
  console.log(`# replaceDeps "${cwd}/package.json": ${JSON.stringify(deps)}`);
  const data = JSON.parse(read("package.json"));
  // deps is like {dep: dir}, for each dir we do getWorkPath(dir), and then replace with file:...
  for (const [dep, depDir] of Object.entries(deps)) {
    depPath = `file:../${depDir}`;
    if (data.dependencies?.[dep]) data.dependencies[dep] = depPath;
    if (data.devDependencies?.[dep]) data.devDependencies[dep] = depPath;
  }
  write("package.json", JSON.stringify(data, null, 2));
  chdir("..");
}

const REPOS = Object.keys(REPO_MAP);

const REPLACE_DEPS_ALL = Object.fromEntries(
  REPOS.map((i) => [REPO_MAP[i].package, `./${i}.tgz`])
);

const getWorkflows = () => [
  ...REPOS.map((i) => () => gitClone(i, REPO_MAP[i].url, undefined)),
  ...REPOS.map((i) => () => exec(i, "npm install && npm run build")),
  ...REPOS.map((i) => () => exec(i, `npm pack && mv *.tgz ../${i}.tgz`)),
  ...REPOS.map((i) => () => replaceDeps(i, REPLACE_DEPS_ALL)),
  ...REPOS.map((i) => () => rm(`${i}/node_modules`)),
  ...REPOS.map(
    (i) => () => exec(i, "npm install && npm run build && npm run test")
  ),
];

// Main
const main = async () => {
  rm(WORK_DIR);
  mkdirp(WORK_DIR);
  chdir(WORK_DIR);
  const ts = Date.now();
  const workflows = getWorkflows();
  console.log();
  for (let i = 0; i < workflows.length; i++) {
    console.log(`${c.yellow}# ${i} started${c.reset}`);
    const workflow = workflows[i];
    const start = Date.now();
    try {
      await workflow();
    } catch (error) {
      throw error;
    }
    const diff = Date.now() - start;
    console.log();
    console.log();
  }
  try {
  } catch (e) {
    console.error(`Failed: ${workflowName}`, e);
    process.exit(1);
  }
  console.log(
    `${c.green}Total time: ${formatDuration(Date.now() - ts)}${c.reset}`
  );
  mkdirp("logs");
  chdir("logs");
  for (let i = 0; i < LOGS.length; i++) {
    const log = LOGS[i];
    const fn = `${i}-${log.repoName || ""}.txt`;
    console.log("# write " + fn);
    fs.writeFileSync(fn, log.stdout + log.stderr);
  }
};
if (require.main === module) main();
