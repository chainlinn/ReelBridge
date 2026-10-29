import { mkdir, readFile, writeFile, rename, rm, stat, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { ROOT } from './config.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function readJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export async function saveJSON(path, data) {
  const tmp = path + '.' + process.pid + '.' + randomBytes(4).toString('hex');
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    await rename(tmp, path);
  } finally { await rm(tmp, { force: true }); }
}

// 同机多客户端共享锁；不抢活进程的锁。异常退出后可回收死 PID 的锁。
export async function withLock(directory, fn, timeout = 300000) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = resolve(directory, '.lock');
  const started = Date.now();
  while (true) {
    try { await mkdir(lock); break; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    try {
      const owner = await readJSON(resolve(lock, 'owner.json'));
      if (owner) {
        try { process.kill(owner.pid, 0); }
        catch (e) {
          if (e.code === 'ESRCH') {
            // 多个等待者不能同时回收：后一个等待者可能误删前一个新建的锁。
            const recovery = resolve(directory, '.lock-recovery');
            let acquired = false;
            try {
              await mkdir(recovery);
              acquired = true;
              const latest = await readJSON(resolve(lock, 'owner.json'));
              if (latest) {
                try { process.kill(latest.pid, 0); }
                catch (error) { if (error.code === 'ESRCH') await rm(lock, { recursive: true, force: true }); }
              }
            } catch (error) { if (!['EEXIST', 'ENOENT'].includes(error.code)) throw error; }
            finally { if (acquired) await rm(recovery, { recursive: true, force: true }); }
          }
        }
      } else if (Date.now() - (await stat(lock)).mtimeMs > timeout) {
        // 不自动移除无法确定归属的锁，避免误伤仍在启动的进程。
        throw new Error('启动锁缺少 owner，请确认无启动进程后清理 ' + lock);
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (Date.now() - started > timeout) throw new Error('等待实例启动锁超时');
    await sleep(100);
  }
  try {
    await saveJSON(resolve(lock, 'owner.json'), { pid: process.pid });
    return await fn();
  } finally { await rm(lock, { recursive: true, force: true }); }
}

// 无 shell，不把 Docker stdout 混入 MCP 协议。Docker 错误只返回固定提示。
export function runDocker(args, { env = process.env, timeout = 300000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;
    child.stdout.on('data', b => { output = (output + b).slice(-1024 * 1024); });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.once('error', () => { clearTimeout(timer); reject(new Error('无法运行 Docker，请安装并启动 Docker 与 Compose v2')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(timedOut ? 'Docker 操作超时；容器可能仍在启动，请查看 Docker 状态' : 'Docker 操作失败，请检查 daemon、镜像、端口和 Compose 配置'));
      else resolvePromise(output.trim());
    });
  });
}

async function portAvailable(port) {
  await new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error('端口 ' + port + ' 已占用；请设置 PANSOU_URL 连接现有服务，或更换 PANSOU_PORT')));
    server.listen(port, '127.0.0.1', () => server.close(resolvePromise));
  });
}

export class Runtime {
  constructor(config, { docker = runDocker, probePort = portAvailable, log = () => {} } = {}) {
    this.config = config; this.docker = docker; this.probePort = probePort; this.log = log;
    this.state = config.mode === 'external' ? 'external' : 'idle';
    this.project = 'reel-bridge-' + createHash('sha256').update(config.dataDir).digest('hex').slice(0, 12);
  }
  start() {
    if (!this.promise) this.promise = this.prepare().catch(e => { this.state = 'error'; this.error = e.message; this.promise = null; throw e; });
    return this.promise;
  }
  async prepare() {
    if (this.config.mode === 'external') return this.config.pansou;
    this.state = 'starting';
    this.error = undefined;
    const { config: c } = this;
    await mkdir(c.dataDir, { recursive: true, mode: 0o700 });
    return withLock(c.dataDir, async () => {
      await this.docker(['info', '--format', '{{.ServerVersion}}'], { timeout: 10000 });
      await this.docker(['compose', 'version', '--short'], { timeout: 10000 });
      const path = resolve(c.dataDir, 'runtime.json');
      let credentials = await readJSON(path);
      if (!credentials) {
        credentials = { user: c.pansou.user || 'admin', pass: c.pansou.pass || randomBytes(24).toString('hex'), jwt: randomBytes(32).toString('hex') };
        if (/[:,\s]/.test(credentials.user) || /[,\r\n]/.test(credentials.pass)) throw new Error('托管账号含有不支持的分隔符');
        await saveJSON(path, credentials);
      }
      if (![credentials.user, credentials.pass, credentials.jwt].every(x => typeof x === 'string' && x.length > 0)) throw new Error('runtime.json 凭据损坏；请恢复文件，勿直接删除已有实例凭据');
      if (c.pansou.user && (c.pansou.user !== credentials.user || c.pansou.pass !== credentials.pass)) throw new Error('托管实例已有不同凭据；请使用原凭据，避免静默修改登录配置');
      await chmod(path, 0o600);
      await mkdir(resolve(c.dataDir, 'data'), { recursive: true });
      const emptyEnv = resolve(c.dataDir, 'compose.env');
      await writeFile(emptyEnv, '# Runtime injects only managed settings.\n', { mode: 0o600 });
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('COMPOSE_') && !key.startsWith('RB_')));
      Object.assign(env, {
        RB_IMAGE: c.runtime.image, RB_PORT: String(c.runtime.port), RB_DATA: resolve(c.dataDir, 'data'),
        RB_OWNER: this.project, RB_AUTH: credentials.user + ':' + credentials.pass, RB_JWT: credentials.jwt,
        RB_PROXY: c.runtime.proxy, RB_GYING_SALT: c.gying.salt,
      });
      const args = ['compose', '--project-name', this.project, '--env-file', emptyEnv, '-f', resolve(ROOT, 'assets/compose.yml')];
      const options = { env, timeout: c.runtime.startupTimeout };
      const ids = await this.docker([...args, 'ps', '-a', '-q', 'pansou'], options);
      if (!ids) await this.probePort(c.runtime.port);
      else {
        const containers = JSON.parse(await this.docker(['inspect', ...ids.split(/\s+/)], options));
        if (containers.some(x => x.Config?.Labels?.['dev.reel-bridge.owner'] !== this.project)) throw new Error('拒绝接管非本运行时创建的容器');
      }
      this.log('准备 PanSou 容器（首次拉镜像可能需要数分钟）');
      await this.docker([...args, 'up', '-d', '--pull', 'missing', '--wait', '--wait-timeout', String(Math.ceil(c.runtime.startupTimeout / 1000))], options);
      this.state = 'ready';
      return { ...c.pansou, user: credentials.user, pass: credentials.pass };
    }, c.runtime.startupTimeout + 10000);
  }
  status() { return { mode: this.config.mode, state: this.state, ...(this.error ? { error: this.error } : {}), ...(this.config.mode === 'managed' ? { project: this.project, data_dir: this.config.dataDir } : {}) }; }
}
