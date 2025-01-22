const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const crypto = require("node:crypto");

// Configuration
const WORK_DIR = process.env.WORK_DIR || "./work";
const LOGS_DIR = process.env.LOGS_DIR || "./logs";
// These will only receive FAILED mails
const DRY_RUN =
  process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const SHELL = "/bin/bash";

// Workflow definitions
// prettier-ignore
const REPO_MAP = {
  // curves: { url: 'https://github.com/paulmillr/noble-curves', package: '@noble-curves' },
  hashes: { url: 'https://github.com/paulmillr/noble-hashes', package: '@noble/hashes' },
  // ciphers: { url: 'https://github.com/paulmillr/noble-ciphers', package: '@noble/ciphers' },
  // pqc: { url: 'https://github.com/paulmillr/noble-post-quantum', package: '@noble/post-quantum' },
  // starknet: { url: 'https://github.com/paulmillr/scure-starknet', package: '@scure/starknet' },
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
  reset: _c + "[0m",
};

// Utils
const sanitizeName = (name) => name.toLowerCase().replace(/\s+/g, "_");
const getWorkPath = (dir) =>
  path.isAbsolute(dir) ? dir : path.resolve(path.join(WORK_DIR, dir));
const read = (filePath) => fs.readFileSync(filePath, "utf8");
const write = (filePath, content = "") => {
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
const formatDate = (ts) =>
  new Date(ts)
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 16);
const sha256 = (msg) => crypto.createHash("sha256").update(msg).digest("hex");
const formatInfo = (ctx) => {
  let body = "";
  if (ctx.nodeVersion) body += `Node: ${ctx.nodeVersion}\n`;
  if (ctx.npmVersion) body += `NPM: ${ctx.npmVersion}\n`;
  body += `Commits:\n`;
  for (const k in ctx.repos || {}) {
    const v = ctx.repos[k];
    body += `- ${k}: ${v.lastCommit}\n`;
    if (v.submodules) {
      body += `${v.submodules
        .split("\n")
        .map((i) => `  ${i}`)
        .join("\n")}\n`;
    }
  }
  return body;
};

const wrapAction =
  (action) =>
  (...args) => {
    const res = (ctx) => action(ctx, ...args);
    const fmtArgs = args.map((arg) => JSON.stringify(arg)).join(", ");
    res.fullName = `${action.name}(${fmtArgs})`;
    return res;
  };

// Actions
const exec = wrapAction(function exec(ctx, dir, cmd) {
  const cwd = getWorkPath(dir);
  if (DRY_RUN) return console.log(`[DRY-RUN] ${cwd}: ${cmd}`);
  const cmdLog = `[EXEC] ${dir}: ${cmd}`
    .split("\n")
    .map((i) => `# ${i}`)
    .join("\n");
  if (!ctx.output) ctx.output = "";
  try {
    const res = execSync(`{ ${cmd} ; } 2>&1`, {
      shell: SHELL,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"], // Capture everything, don't show in terminal
      cwd,
      env: { ...process.env, ...(ctx.env || {}) },
    });
    ctx.output += `${cmdLog}\n${res || ""}\n`;
    return res.trim();
  } catch (e) {
    ctx.output += `${cmdLog}\n${e.stdout || ""}\n${e.stderr || ""}\n`;
    throw new Error(`[EXEC] ${dir} command failed: status=${e.status}`);
  }
});

const cleanDir = wrapAction(function cleanDir(ctx, dir) {
  const cwd = getWorkPath(dir);
  if (DRY_RUN) return console.log(`[DRY-RUN] rm -rf ${cwd}`);
  if (!ctx.output) ctx.output = "";
  ctx.output += `# rm -rf ${cwd}\n`;
  fs.rmSync(cwd, { recursive: true, force: true });
});

const ensureDir = wrapAction(function ensureDir(ctx, dir) {
  const cwd = getWorkPath(dir);
  if (DRY_RUN) return console.log(`[DRY-RUN] mkdir -p ${cwd}`);
  if (!ctx.output) ctx.output = "";
  ctx.output += `# mkdir -p ${cwd}\n`;
  fs.mkdirSync(cwd, { recursive: true });
});

const gitClone = wrapAction(function gitClone(ctx, dir, repoUrl, branch) {
  const cwd = getWorkPath(dir);
  if (DRY_RUN)
    return console.log(
      `[DRY-RUN] git clone ${repoUrl} ${dir} (branch: ${branch})`
    );
  cleanDir(dir)(ctx);
  exec(
    "",
    `git clone ${branch ? `-b ${branch}` : ""} --depth 1 "${repoUrl}" "${cwd}"`
  )(ctx);
  exec(dir, `git submodule update --init --recursive --depth 1`)(ctx);
  if (!ctx.repos) ctx.repos = {};
  if (!ctx.repos[repoUrl]) ctx.repos[repoUrl] = { branch };
  ctx.repos[repoUrl].lastCommit = exec(
    dir,
    'git log -1 --pretty=format:"%H %an %s"'
  )(ctx);
  ctx.repos[repoUrl].submodules = exec(dir, "git submodule status")(ctx);
});

const replaceDeps = wrapAction(function replaceDeps(ctx, dir, deps) {
  const cwd = getWorkPath(dir);
  if (DRY_RUN)
    return console.log(
      `[DRY-RUN] patchDeps "${cwd}/package.json": ${JSON.stringify(deps)}`
    );
  const packagePath = path.join(cwd, "package.json");
  if (!ctx.output) ctx.output = "";
  ctx.output += `# patchDeps ${packagePath} (${JSON.stringify(deps)})\n`;
  const data = JSON.parse(read(packagePath));
  // deps is like {dep: dir}, for each dir we do getWorkPath(dir), and then replace with file:...
  for (const [dep, depDir] of Object.entries(deps)) {
    depPath = `file:${path.relative(cwd, getWorkPath(depDir))}`;
    if (data.dependencies?.[dep]) data.dependencies[dep] = depPath;
    if (data.devDependencies?.[dep]) data.devDependencies[dep] = depPath;
  }
  write(packagePath, JSON.stringify(data, null, 2));
});

const envFlag = wrapAction(function env(ctx, key, value) {
  if (DRY_RUN) console.log(`[DRY-RUN] env set ${key}=${value}`);
  if (!ctx.env) ctx.env = {};
  ctx.env[key] = value;
});

// Workflow executor
const executeWorkflow = async (name, workflow) => {
  const ts = Date.now();
  const context = { name, workDir: WORK_DIR, date: formatDate(ts) };
  context.runDir = path.join(
    LOGS_DIR,
    context.date,
    sanitizeName(context.name)
  );
  context.logDir = path.join(context.runDir, "logs");
  const statusPath = path.join(context.runDir, "status.json");
  const status = {
    date: formatDate(Date.now()),
    steps: [],
    status: "started",
    context,
  };
  const updateStatus = () => {
    if (DRY_RUN) return;
    status.duration = formatDuration(Date.now() - ts);
    write(statusPath, JSON.stringify(status, null, 2));
  };
  console.log(`Starting workflow: ${name} (${context.logDir})`);
  let curStep = {};
  try {
    ensureDir(context.logDir)(context);
    let i = 0;
    for (const step of workflow) {
      curStep = { i, ts: Date.now(), name: step.fullName, status: "started" };
      status.steps.push(curStep);
      curStep.duration = formatDuration(Date.now() - curStep.ts);
      curStep.logPath = path.join(
        context.logDir,
        `${i}-${sanitizeName(curStep.name).split("(")[0]}.log`
      );
      console.log(curStep.name);
      step(context);
      write(curStep.logPath, context.output);
      curStep.status = "done";
      context.output = "";
      const dur = Date.now() - curStep.ts;
      curStep.duration = formatDuration(dur);
      if (dur > 15000 || step.fullName.includes("npm run test"))
        console.log(`# done in ${c.green}${curStep.duration}${c.reset}`);
      updateStatus();
      i++;
    }
    status.status = "done";
    curStep = {}; // success, lets clean
  } catch (e) {
    curStep.duration = formatDuration(Date.now() - curStep.ts);
    curStep.status = "failed";
    status.status = "failed";
    console.log(`${c.red}step failed${c.reset}`);
    if (!context.output) context.output = "";
    context.output += `# Error: ${e.message}\n${e.stack}\n`;
    if (curStep.name) write(curStep.logPath, context.output);
  }
  updateStatus();
  // Don't override last output command
  console.log(context.runDir, context.logDir);
  const saveLogCtx = { ...context };
  try {
    exec(
      context.runDir,
      "tar -cjf logs.tar.bz2 --exclude=logs.tar.bz2 logs/"
    )(saveLogCtx);
  } catch (e) {
    console.error("log save error", e, saveLogCtx);
  }
};

const REPOS = Object.keys(REPO_MAP);

const REPLACE_DEPS_ALL = Object.fromEntries(
  REPOS.map((i) => [REPO_MAP[i].package, `./${i}.tgz`])
);

const WORKFLOWS = {
  // We test all latest version of packages with other packages as deps to make sure nothing is broken
  // 25m 48s + 12m 21s = 38m 9s, probably can faster if parallel?
  Integrations: [
    //nvmUse('--lts'),
    envFlag("MSHOULD_FAST", "1"),
    ...REPOS.map((i) => gitClone(i, REPO_MAP[i].url, undefined)),
    ...REPOS.map((i) => exec(i, "npm install && npm run build")),
    ...REPOS.map((i) => exec(i, `npm pack && mv *.tgz ../${i}.tgz`)),
    ...REPOS.map((i) => replaceDeps(i, REPLACE_DEPS_ALL)),
    ...REPOS.map((i) => cleanDir(`${i}/node_modules`)),
    ...REPOS.map((i) =>
      exec(i, "npm install && npm run build && npm run test")
    ),
  ],
};

// Main
const main = async () => {
  const cliWorkflows = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"));
  const toRun = cliWorkflows.length > 0 ? cliWorkflows : Object.keys(WORKFLOWS);
  const ts = Date.now();
  for (const workflowName of toRun) {
    const workflow = WORKFLOWS[workflowName];
    if (!workflow) {
      console.error(`Unknown workflow: ${workflowName}`);
      continue;
    }
    try {
      await executeWorkflow(workflowName, workflow);
    } catch (e) {
      console.error(`Failed: ${workflowName}`, e);
      process.exit(1);
    }
  }
  console.log(
    `${c.green}Total time: ${formatDuration(Date.now() - ts)}${c.reset}`
  );
};
if (require.main === module) main();
