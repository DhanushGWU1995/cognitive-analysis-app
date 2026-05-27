import { CommonModule } from '@angular/common';
import { Component, computed, effect, signal } from '@angular/core';

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  template: `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="logo">SELeCT</div>
          <div class="subtitle">Toddler Memory (Web)</div>
        </div>
        <div class="chip" *ngIf="screen() === 'run'">Trial {{ trialIndex() + 1 }} / {{ trials() }}</div>
      </header>

      <main class="main">
        <section class="card" *ngIf="screen() === 'home'">
          <h1>Pick a game</h1>
          <p class="muted">Runs entirely in the browser (GitHub Pages). Works best in fullscreen.</p>
          <div class="grid2">
            <button class="big-btn" (click)="goSetup(TaskType.Location)">
              <div class="emoji">📍</div>
              <div class="txt">
                <div class="t">Location memory</div>
                <div class="d">Remember where it appears.</div>
              </div>
            </button>
            <button class="big-btn" (click)="goSetup(TaskType.Picture)">
              <div class="emoji">🖼️</div>
              <div class="txt">
                <div class="t">Picture memory</div>
                <div class="d">Remember which picture it is.</div>
              </div>
            </button>
          </div>
          <div class="footer-row">
            <a class="link" href="https://github.com/DhanushGWU1995/cognitive-analysis-app" target="_blank" rel="noopener">
              View repo
            </a>
          </div>
        </section>

        <section class="card" *ngIf="screen() === 'setup'">
          <h1>Setup</h1>
          <p class="muted">Task: <b>{{ taskType() }}</b></p>

          <div class="form">
            <label>
              <div class="lbl">Subject ID</div>
              <input [value]="subjectId()" (input)="subjectId.set(($any($event.target).value || '').toString())" />
            </label>
            <label>
              <div class="lbl">Trials</div>
              <input type="number" min="1" max="50" [value]="trials()" (input)="trials.set(+$any($event.target).value)" />
            </label>
            <label>
              <div class="lbl">StepsNum (sequence length)</div>
              <input type="number" min="1" max="5" [value]="stepsNum()" (input)="stepsNum.set(+$any($event.target).value)" />
            </label>
            <label>
              <div class="lbl">Distractors (N)</div>
              <input type="number" min="0" max="12" [value]="distractorsN()" (input)="distractorsN.set(+$any($event.target).value)" />
            </label>
            <label>
              <div class="lbl">Study timer (seconds per item)</div>
              <input type="number" min="1" max="10" [value]="studySeconds()" (input)="studySeconds.set(+$any($event.target).value)" />
            </label>
          </div>

          <div class="seq-editor" *ngIf="taskType() === TaskType.Picture">
            <h2>Picture sequence (one row per trial)</h2>
            <p class="muted small">Pick a picture for each step. StepsNum controls how many dropdowns appear per trial.</p>

            <div class="seq-table">
              <div class="seq-row header">
                <div class="cell h">Trial</div>
                <div class="cell h" *ngFor="let _ of [].constructor(stepsNum()); let si = index">Step {{ si + 1 }}</div>
              </div>

              <div class="seq-row" *ngFor="let _ of [].constructor(trials()); let ti = index">
                <div class="cell trial">{{ ti + 1 }}</div>
                <div class="cell" *ngFor="let __ of [].constructor(stepsNum()); let si = index">
                  <select
                    class="pick"
                    [value]="pictureSequences()[ti]?.[si] ?? 1"
                    (change)="setPictureStep(ti, si, $any($event.target).value)"
                  >
                    <option *ngFor="let pid of picIds" [value]="pid">{{ pad3(pid) }}</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="actions">
            <button class="btn ghost" (click)="screen.set('home')">Back</button>
            <button class="btn primary" [disabled]="!canStart()" (click)="start()">Start</button>
          </div>
        </section>

        <section class="stage" *ngIf="screen() === 'run'">
          <div class="stage-top">
            <div class="title" *ngIf="phase() === 'study'">
              {{ taskType() === TaskType.Location ? 'Location memory' : 'Picture memory' }}
            </div>
            <div class="subtitle" *ngIf="phase() === 'study'">
              {{
                taskType() === TaskType.Location
                  ? 'Watch where it appears. Remember the place, not the picture.'
                  : 'Watch each picture. Remember the image, not where it appears.'
              }}
            </div>
            <div class="meta" *ngIf="phase() === 'study'">
              {{ taskType() === TaskType.Location ? 'Place' : 'Picture' }} {{ stepIndex() + 1 }} of {{ currentSequence().length }} ·
              <span class="countdown">{{ countdown() }}</span>
            </div>

            <div class="title" *ngIf="phase() === 'test'">
              {{ taskType() === TaskType.Location ? 'Touch each place in order!' : 'Touch each picture in order!' }}
            </div>
            <div class="subtitle" *ngIf="phase() === 'test'">Step {{ pressed().length + 1 }} of {{ currentSequence().length }}</div>
          </div>

          <div class="grid4" *ngIf="taskType() === TaskType.Location">
            <button
              class="cell"
              *ngFor="let cell of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]"
              [class.active]="isLocationCellActive(cell)"
              [class.pressed]="isChoiceSelected(cell)"
              [disabled]="phase() !== 'test' || !testChoices().includes(cell)"
              (click)="onPick(cell)"
            >
              <img class="pic" [src]="'assets/pics/' + pad3(cell) + '.jpg'" alt="" draggable="false" />
            </button>
          </div>

          <div class="choices" *ngIf="taskType() === TaskType.Picture">
            <button class="choice study" *ngIf="phase() === 'study'" disabled>
              <img class="pic big" [src]="'assets/pics/' + pad3(currentSequence()[stepIndex()]) + '.jpg'" alt="" />
            </button>

            <div class="choice-grid" *ngIf="phase() === 'test'">
              <button class="choice" *ngFor="let p of testChoices()" (click)="onPick(p)" [class.pressed]="isChoiceSelected(p)">
                <img class="pic" [src]="'assets/pics/' + pad3(p) + '.jpg'" alt="" />
              </button>
            </div>
          </div>

          <div class="feedback" *ngIf="feedback()">
            <div class="pill" [class.ok]="feedback() === 'correct'" [class.no]="feedback() === 'wrong'">
              {{ feedback() === 'correct' ? 'Correct!' : 'Try again' }}
            </div>
          </div>

          <div class="congrats" *ngIf="showCongrats()">
            <video class="congrats-video" src="assets/video/congrats.mp4" autoplay muted playsinline></video>
            <div class="congrats-text">Great job!</div>
          </div>
        </section>

        <section class="card" *ngIf="screen() === 'results'">
          <h1>All finished!</h1>
          <p class="muted">Download results as CSV.</p>
          <div class="actions">
            <button class="btn ghost" (click)="screen.set('home')">New session</button>
            <button class="btn primary" (click)="downloadCsv()">Download CSV</button>
          </div>
          <div class="mini">Completed: {{ results().length }} / {{ trials() }} trial(s)</div>
        </section>
      </main>
    </div>
  `,
  styleUrl: './app.component.scss'
})
export class AppComponent {
  readonly TaskType = {
    Location: 'location',
    Picture: 'picture',
  } as const;

  readonly screen = signal<'home' | 'setup' | 'run' | 'results'>('home');
  readonly taskType = signal<(typeof this.TaskType)[keyof typeof this.TaskType]>(this.TaskType.Location);

  // Session setup
  readonly subjectId = signal('kid001');
  readonly trials = signal(5);
  readonly stepsNum = signal(2);
  readonly distractorsN = signal(1);
  readonly studySeconds = signal(5);

  // Runtime
  readonly trialIndex = signal(0);
  readonly phase = signal<'study' | 'test' | 'done'>('study');
  readonly stepIndex = signal(0); // within-trial sequence step
  readonly countdown = signal(0);
  readonly pressed = signal<number[]>([]);
  readonly feedback = signal<'correct' | 'wrong' | null>(null);
  readonly showCongrats = signal(false);

  // A tiny built-in demo sequence plan (one line per trial)
  readonly locationSequences = signal<number[][]>([
    [13, 6],
    [10, 3],
    [14, 11],
    [2, 5],
    [7, 16],
  ]);

  readonly pictureSequences = signal<number[][]>([
    [13, 5],
    [8, 2],
    [21, 7],
    [11, 19],
    [3, 15],
  ]);

  // Assets: pics are 001.jpg..099.jpg
  readonly picIds = Array.from({ length: 99 }, (_v, i) => i + 1);

  readonly results = signal<
    Array<{
      trial: number;
      taskType: 'location' | 'picture';
      sequence: number[];
      presses: number[];
      correct: boolean;
      ms: number;
    }>
  >([]);

  private trialStartedAt = 0;
  private timer: number | null = null;
  private congratsTimer: number | null = null;

  readonly currentSequence = computed(() => {
    const t = this.trialIndex();
    const seqs = this.taskType() === this.TaskType.Location ? this.locationSequences() : this.pictureSequences();
    const seq = seqs[Math.min(t, seqs.length - 1)] ?? [];
    return (seq.length ? seq : [1]).slice(0, Math.max(1, this.stepsNum()));
  });

  readonly testChoices = computed(() => {
    const seq = this.currentSequence();
    const n = Math.max(0, Math.min(12, this.distractorsN()));
    const poolMax = this.taskType() === this.TaskType.Location ? 16 : 30;
    const base = [...new Set(seq)];
    const out = [...base];
    while (out.length < base.length + n) {
      const r = 1 + Math.floor(Math.random() * poolMax);
      if (!out.includes(r)) out.push(r);
    }
    // Shuffle on-screen positions every render
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  });

  readonly expectedNext = computed(() => {
    const seq = this.currentSequence();
    const k = Math.min(this.pressed().length, seq.length - 1);
    return seq[k];
  });

  readonly canStart = computed(() => {
    const okId = this.subjectId().trim().length >= 2;
    return okId && this.trials() >= 1 && this.stepsNum() >= 1 && this.studySeconds() >= 1;
  });

  constructor() {
    // Ensure no timers leak between screens
    effect(() => {
      const s = this.screen();
      if (s !== 'run') this._stopTimer();
    });

    // Keep per-trial sequence arrays in sync with Trials + StepsNum.
    effect(() => {
      // reading signals establishes deps
      const t = Math.max(1, Math.min(50, this.trials()));
      const steps = Math.max(1, Math.min(5, this.stepsNum()));
      const task = this.taskType();
      if (task === this.TaskType.Picture) {
        this.pictureSequences.set(this._normalizeSequences(this.pictureSequences(), t, steps, 1, 99));
      } else {
        this.locationSequences.set(this._normalizeSequences(this.locationSequences(), t, steps, 1, 16));
      }
    });
  }

  goSetup(type: 'location' | 'picture') {
    this.taskType.set(type);
    this.screen.set('setup');
  }

  start() {
    if (!this.canStart()) return;
    this.results.set([]);
    this.trialIndex.set(0);
    this.phase.set('study');
    this.stepIndex.set(0);
    this.countdown.set(this.studySeconds());
    this.pressed.set([]);
    this.feedback.set(null);
    this.showCongrats.set(false);
    this.trialStartedAt = performance.now();
    this.screen.set('run');
    this._runStudyTick();
  }

  private _runStudyTick() {
    this._stopTimer();
    this.phase.set('study');
    this.feedback.set(null);
    this.countdown.set(this.studySeconds());

    const tick = () => {
      const left = this.countdown();
      if (left <= 1) {
        this.countdown.set(0);
        window.setTimeout(() => this._advanceStudyOrTest(), 250);
        return;
      }
      this.countdown.set(left - 1);
      this.timer = window.setTimeout(tick, 1000);
    };

    this.timer = window.setTimeout(tick, 1000);
  }

  private _advanceStudyOrTest() {
    const step = this.stepIndex();
    const seq = this.currentSequence();
    if (step + 1 < seq.length) {
      this.stepIndex.set(step + 1);
      this._runStudyTick();
      return;
    }
    // Move to test
    this.phase.set('test');
    this.stepIndex.set(0);
    this.pressed.set([]);
    this.feedback.set(null);
    this._stopTimer();
  }

  onPick(choice: number) {
    if (this.phase() !== 'test') return;
    const presses = this.pressed();
    const expected = this.expectedNext();

    // Ignore repeats unless it is the next expected step (handles 13,13 sequences).
    if (presses.includes(choice) && choice !== expected) return;

    const next = [...presses, choice];
    this.pressed.set(next);
    const ok = choice === expected;
    this.feedback.set(ok ? 'correct' : 'wrong');
    this._play(ok ? 'correct' : 'wrong');

    if (!ok) {
      // brief feedback then clear
      window.setTimeout(() => this.feedback.set(null), 450);
      return;
    }

    if (next.length >= this.currentSequence().length) {
      const ms = Math.max(0, Math.round(performance.now() - this.trialStartedAt));
      const correct = next.join(',') === this.currentSequence().join(',');
      this.results.set([
        ...this.results(),
        {
          trial: this.trialIndex() + 1,
          taskType: this.taskType(),
          sequence: this.currentSequence(),
          presses: next,
          correct,
          ms,
        },
      ]);

      this._play('success');
      this._congratsBurst();
      window.setTimeout(() => this._nextTrialOrDone(), 900);
    } else {
      window.setTimeout(() => this.feedback.set(null), 450);
    }
  }

  private _nextTrialOrDone() {
    const t = this.trialIndex() + 1;
    if (t >= this.trials()) {
      this.phase.set('done');
      this.screen.set('results');
      return;
    }
    this.trialIndex.set(t);
    this.phase.set('study');
    this.stepIndex.set(0);
    this.pressed.set([]);
    this.feedback.set(null);
    this.trialStartedAt = performance.now();
    this._runStudyTick();
  }

  downloadCsv() {
    const rows = this.results();
    const header = ['subject', 'trial', 'taskType', 'sequence', 'presses', 'correct', 'ms'];
    const lines = [
      header.join(','),
      ...rows.map((r) =>
        [
          this.subjectId().trim(),
          r.trial,
          r.taskType,
          `"${r.sequence.join(' ')}"`,
          `"${r.presses.join(' ')}"`,
          r.correct ? '1' : '0',
          r.ms,
        ].join(','),
      ),
    ];
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `select-toddler-${this.taskType()}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  private _stopTimer() {
    if (this.timer != null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private _congratsBurst() {
    this.showCongrats.set(true);
    if (this.congratsTimer != null) window.clearTimeout(this.congratsTimer);
    this.congratsTimer = window.setTimeout(() => this.showCongrats.set(false), 3200);
  }

  private _play(name: 'correct' | 'wrong' | 'success') {
    const map: Record<typeof name, string> = {
      correct: 'assets/sfx/ding2.mp3',
      wrong: 'assets/sfx/whoosh1.wav',
      success: 'assets/sfx/applause.mp3',
    };
    const audio = new Audio(map[name]);
    audio.volume = 0.9;
    void audio.play().catch(() => {});
  }

  // UI helpers
  isLocationCellActive(cell: number) {
    if (this.taskType() !== this.TaskType.Location) return false;
    const seq = this.currentSequence();
    if (this.phase() === 'study') return seq[this.stepIndex()] === cell;
    if (this.phase() !== 'test') return false;
    // highlight next expected location
    return this.expectedNext() === cell;
  }

  isChoiceSelected(choice: number) {
    return this.pressed().includes(choice);
  }

  pad3(n: number) {
    const x = Math.max(0, Math.floor(n));
    return x.toString().padStart(3, '0');
  }

  setPictureStep(trialIdx: number, stepIdx: number, value: string) {
    const pic = Math.max(1, Math.min(99, Number(value) || 1));
    const t = Math.max(1, this.trials());
    const steps = Math.max(1, this.stepsNum());
    const next = this._normalizeSequences(this.pictureSequences(), t, steps, 1, 99).map((row) => [...row]);
    if (!next[trialIdx]) return;
    next[trialIdx][stepIdx] = pic;
    this.pictureSequences.set(next);
  }

  setLocationStep(trialIdx: number, stepIdx: number, value: string) {
    const cell = Math.max(1, Math.min(16, Number(value) || 1));
    const t = Math.max(1, this.trials());
    const steps = Math.max(1, this.stepsNum());
    const next = this._normalizeSequences(this.locationSequences(), t, steps, 1, 16).map((row) => [...row]);
    if (!next[trialIdx]) return;
    next[trialIdx][stepIdx] = cell;
    this.locationSequences.set(next);
  }

  private _normalizeSequences(
    seqs: number[][],
    trials: number,
    steps: number,
    minVal: number,
    maxVal: number,
  ) {
    const safeVal = (x: number | undefined, fallback: number) => {
      const n = Number(x);
      if (!Number.isFinite(n)) return fallback;
      return Math.max(minVal, Math.min(maxVal, Math.floor(n)));
    };
    const out: number[][] = [];
    for (let i = 0; i < trials; i++) {
      const prev = seqs[i] ?? seqs[seqs.length - 1] ?? [];
      const row: number[] = [];
      for (let s = 0; s < steps; s++) {
        const fb = safeVal(prev[s], minVal);
        row.push(fb);
      }
      out.push(row);
    }
    return out;
  }
}
