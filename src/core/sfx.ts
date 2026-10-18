/**
 * core/sfx — 程序化音效（WebAudio，零资源文件）。
 *
 * 浏览器要求 AudioContext 必须在用户手势后才能出声：在开始战斗的点击里调
 * resume() 即可。所有声音都是噪声缓冲 + 振荡器合成，音量统一走 master。
 * 每类音效带最小间隔节流，避免连射时叠成噪声墙。
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last: Record<string, number> = {};
  /** 静音开关（主增益归零，保留上下文） */
  muted = false;

  /** 首次用户手势时调用（点击开始战斗 / pointerdown） */
  resume(): void {
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      // 1s 白噪声缓冲（枪声/爆炸的原料）
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.startAmbient();
    if (this.musicOn) this.startMusic();
  }

  // ---- 程序化背景音乐：低音铺底 + 五度 + 小调五声琶音，2.4s 一小节循环 ----
  private musicOn = true;
  private musicTimer: number | null = null;
  private musicStep = 0;
  /** 音阶情绪（由关卡设置）：根音频率 + 半音阶集合 */
  private moodRoot = 55;
  private moodScale = [0, 3, 5, 7, 10];

  /** 按关卡切换音乐情绪（火山更低沉、冰原更清冷） */
  setMood(root: number, scale: number[]): void {
    this.moodRoot = root;
    this.moodScale = scale;
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (!on && this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (on && this.ctx) this.startMusic();
  }

  private startMusic(): void {
    if (this.musicTimer !== null) return;
    const step = (): void => {
      // 页面在后台时 AudioContext 会被挂起：currentTime 不前进，跳过以免音符堆积
      if (!this.ctx || !this.musicOn || this.muted || this.ctx.state !== 'running') return;
      this.scheduleBar();
    };
    step();
    this.musicTimer = window.setInterval(step, 2400);
  }

  /** 一小节：根音低音 + 纯五度 + 概率琶音（音阶情绪由关卡决定） */
  private scheduleBar(): void {
    const root = this.moodRoot * (this.musicStep % 4 === 3 ? 1.19 : 1); // 每 4 小节升一度制造走向
    this.musicStep += 1;
    this.tone('triangle', root, root * 0.995, 2.4, 0.075);
    this.tone('sine', root * 1.5, root * 1.5, 2.4, 0.038);
    for (let i = 0; i < 3; i++) {
      if (Math.random() < 0.32) continue;
      const f = root * 4 * Math.pow(2, this.moodScale[Math.floor(Math.random() * this.moodScale.length)] / 12);
      this.tone('triangle', f, f * 0.995, 0.55, 0.03, i * 0.62 + Math.random() * 0.25);
    }
  }

  /** 环境底噪：循环棕噪声过低通，音量极低（风声/荒原氛围） */
  private ambient: { src: AudioBufferSourceNode } | null = null;
  private startAmbient(): void {
    if (!this.ctx || !this.master || this.ambient) return;
    const len = Math.floor(this.ctx.sampleRate * 3);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let acc = 0;
    for (let i = 0; i < len; i++) {
      acc = acc * 0.985 + (Math.random() * 2 - 1) * 0.05;
      data[i] = Math.max(-1, Math.min(1, acc * 3));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 340;
    const g = this.ctx.createGain();
    g.gain.value = 0.045;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    this.ambient = { src };
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  /** 主音量 0..1（持久化在设置里） */
  private volume = 0.5;
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master && !this.muted) this.master.gain.value = this.volume;
  }

  private ok(key: string, minGapMs: number): boolean {
    if (!this.ctx || !this.master || this.muted) return false;
    const now = performance.now();
    if (now - (this.last[key] ?? -1e9) < minGapMs) return false;
    this.last[key] = now;
    return true;
  }

  /** 噪声爆点：低通从 f0 扫到 f1，指数衰减 */
  private noiseBurst(dur: number, f0: number, f1: number, gain: number, delay = 0): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.7 + Math.random() * 0.5;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** 振荡器扫频 */
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 枪声：不同枪型有不同的"体重" */
  shot(kind: 'rifle' | 'shotgun' | 'pistol' | 'smg' | 'sniper'): void {
    if (!this.ok('shot', 45)) return;
    switch (kind) {
      case 'pistol':
        this.noiseBurst(0.09, 3600, 700, 0.22);
        this.tone('square', 300, 90, 0.05, 0.1);
        break;
      case 'smg':
        this.noiseBurst(0.07, 4200, 900, 0.18);
        this.tone('square', 340, 120, 0.04, 0.08);
        break;
      case 'shotgun':
        this.noiseBurst(0.22, 2600, 300, 0.34);
        this.tone('square', 160, 50, 0.12, 0.16);
        break;
      case 'sniper':
        this.noiseBurst(0.3, 3000, 200, 0.36);
        this.tone('sawtooth', 200, 45, 0.2, 0.16);
        break;
      default:
        this.noiseBurst(0.12, 3800, 600, 0.26);
        this.tone('square', 260, 70, 0.07, 0.12);
    }
  }

  /** 命中 */
  hit(): void {
    if (!this.ok('hit', 40)) return;
    this.tone('square', 900, 420, 0.035, 0.06);
  }

  /** 击杀：上扬短音 */
  kill(): void {
    if (!this.ok('kill', 70)) return;
    this.tone('triangle', 480, 940, 0.1, 0.12);
  }

  /** 连杀提示音（音高随连杀数上抬） */
  streak(n: number): void {
    const base = 420 + Math.min(12, n) * 45;
    this.tone('triangle', base, base * 1.6, 0.13, 0.14);
    this.tone('triangle', base * 1.5, base * 2.2, 0.13, 0.1, 0.08);
  }

  /** 玩家受伤：闷响 */
  hurt(): void {
    if (!this.ok('hurt', 180)) return;
    this.tone('sawtooth', 130, 55, 0.2, 0.22);
    this.noiseBurst(0.1, 500, 120, 0.12);
  }

  /** 换弹：两声机械咔哒 */
  reload(): void {
    this.noiseBurst(0.03, 2400, 800, 0.16);
    this.noiseBurst(0.03, 2000, 600, 0.18, 0.13);
  }

  /** 敌人远程出手：短促嗖声 */
  spit(): void {
    if (!this.ok('spit', 90)) return;
    this.noiseBurst(0.13, 1800, 350, 0.12);
  }

  /** 升级：上行琶音（四音） */
  levelUp(): void {
    const notes = [440, 554, 659, 880];
    notes.forEach((f, i) => this.tone('triangle', f, f, 0.14, 0.14, i * 0.09));
  }

  /** 拾取增益：上扬双音 */
  pickup(): void {
    if (!this.ok('pickup', 100)) return;
    this.tone('triangle', 620, 930, 0.07, 0.12);
    this.tone('triangle', 930, 1240, 0.09, 0.1, 0.06);
  }

  /** 爆炸（自爆兵 / 践踏 / BOSS 死亡） */
  boom(): void {
    if (!this.ok('boom', 120)) return;
    this.noiseBurst(0.5, 900, 60, 0.5);
    this.tone('sawtooth', 110, 32, 0.4, 0.24);
  }

  /** BOSS 登场低吼 */
  roar(): void {
    this.tone('sawtooth', 95, 40, 0.75, 0.3);
    this.tone('sawtooth', 130, 55, 0.6, 0.18, 0.05);
    this.noiseBurst(0.5, 600, 90, 0.14);
  }

  /** 波次开始提示 */
  wave(): void {
    this.tone('triangle', 330, 660, 0.16, 0.14);
  }
}

export const sfx = new Sfx();
