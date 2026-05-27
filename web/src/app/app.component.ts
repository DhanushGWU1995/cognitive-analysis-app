import { CommonModule } from '@angular/common';
import { Component, computed, effect, signal, untracked } from '@angular/core';

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
                  <button class="pick pick-visual" type="button" (click)="openPicPicker(ti, si)">
                    <img class="pick-thumb" [src]="'assets/pics/' + pad3(pictureSequences()[ti][si]) + '.jpg'" alt="" loading="lazy" />
                    <span class="pick-label">{{ pad3(pictureSequences()[ti][si]) }}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Visual picture picker overlay -->
          <div class="picker-overlay" *ngIf="picPickerOpen()" (click)="closePicPicker()">
            <div class="picker" (click)="$event.stopPropagation()">
              <div class="picker-top">
                <div class="picker-title">
                  Pick picture — Trial {{ picPickerTrial() + 1 }}, Step {{ picPickerStep() + 1 }}
                </div>
                <button class="btn ghost" type="button" (click)="closePicPicker()">Close</button>
              </div>
              <div class="picker-grid">
                <button
                  class="picker-item"
                  *ngFor="let pid of picIds"
                  type="button"
                  [disabled]="isPicDisabledInTrial(picPickerTrial(), picPickerStep(), pid)"
                  (click)="pickPic(pid)"
                >
                  <img class="picker-img" [src]="'assets/pics/' + pad3(pid) + '.jpg'" alt="" loading="lazy" />
                  <div class="picker-id">{{ pad3(pid) }}</div>
                </button>
              </div>
            </div>
          </div>

          <div class="seq-editor" *ngIf="taskType() === TaskType.Location">
            <h2>Location sequence (one row per trial)</h2>
            <p class="muted small">Pick a grid cell (1–16) for each step. StepsNum controls how many picks per trial.</p>

            <div class="seq-table">
              <div class="seq-row header">
                <div class="cell h">Trial</div>
                <div class="cell h" *ngFor="let _ of [].constructor(stepsNum()); let si = index">Step {{ si + 1 }}</div>
              </div>

              <div class="seq-row" *ngFor="let _ of [].constructor(trials()); let ti = index">
                <div class="cell trial">{{ ti + 1 }}</div>
                <div class="cell" *ngFor="let __ of [].constructor(stepsNum()); let si = index">
                  <button class="pick pick-loc" type="button" (click)="openLocPicker(ti, si)">
                    <span class="loc-pill">{{ locationSequences()[ti][si] }}</span>
                    <span class="pick-label">Cell</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Location picker overlay -->
          <div class="picker-overlay" *ngIf="locPickerOpen()" (click)="closeLocPicker()">
            <div class="picker" (click)="$event.stopPropagation()">
              <div class="picker-top">
                <div class="picker-title">
                  Pick location — Trial {{ locPickerTrial() + 1 }}, Step {{ locPickerStep() + 1 }}
                </div>
                <button class="btn ghost" type="button" (click)="closeLocPicker()">Close</button>
              </div>
              <div class="loc-grid">
                <button
                  class="loc-cell"
                  *ngFor="let cell of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]"
                  type="button"
                  [disabled]="isLocDisabledInTrial(locPickerTrial(), locPickerStep(), cell)"
                  (click)="pickLoc(cell)"
                >
                  {{ cell }}
                </button>
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
            <div class="step-progress" *ngIf="phase() === 'test' && taskType() === TaskType.Location">
              <div
                class="step-badge"
                *ngFor="let _ of [].constructor(currentSequence().length); let i = index"
                [class.done]="i < pressed().length"
              >
                <span class="num">{{ i + 1 }}</span>
                <span class="face" *ngIf="i < pressed().length">😊</span>
              </div>
            </div>
          </div>

          <div class="grid4" *ngIf="taskType() === TaskType.Location">
            <button
              class="cell"
              *ngFor="let cell of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]"
              [class.active]="phase() === 'study' && isLocationCellActive(cell)"
              [class.pressed]="isChoiceSelected(cell)"
              [class.dim]="phase() === 'test' && !testChoices().includes(cell)"
              [disabled]="phase() === 'test' ? !testChoices().includes(cell) : true"
              (click)="onPick(cell)"
            >
              <div class="cell-step" *ngIf="phase() === 'test' && pressedBadges()[cell] as n">
                <span class="n">{{ n }}</span>
                <span class="s">😊</span>
              </div>
              <!-- Study: show ONLY the active cell picture (clearer). Test: show only choice cells. -->
              <ng-container *ngIf="(phase() === 'study' && isLocationCellActive(cell)) || (phase() === 'test' && testChoices().includes(cell)); else emptyCell">
                <img
                  class="pic"
                  [src]="
                    'assets/pics/' +
                    pad3(
                      phase() === 'study'
                        ? locStudyPicId()
                        : (locTestPics()[cell] ?? 1)
                    ) +
                    '.jpg'
                  "
                  alt=""
                  draggable="false"
                  loading="lazy"
                />
              </ng-container>
              <ng-template #emptyCell>
                <div class="cell-empty" aria-hidden="true"></div>
              </ng-template>
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
  readonly pressedOrder = signal<Array<{ cell: number; step: number }>>([]);
  readonly feedback = signal<'correct' | 'wrong' | null>(null);
  readonly showCongrats = signal(false);
  // Location task: pictures are just visual tokens (identity irrelevant)
  readonly locStudyPicId = signal(1);
  readonly locTestPics = signal<Record<number, number>>({});

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
  private activeAudio: HTMLAudioElement[] = [];

  // Picture picker overlay (visual selection)
  readonly picPickerOpen = signal(false);
  readonly picPickerTrial = signal(0);
  readonly picPickerStep = signal(0);
  // Location picker overlay (4x4 grid selection)
  readonly locPickerOpen = signal(false);
  readonly locPickerTrial = signal(0);
  readonly locPickerStep = signal(0);

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

  readonly pressedBadges = computed(() => {
    // For location task: map cell -> last completed step number (handles repeats by showing latest)
    const map: Record<number, number> = {};
    for (const p of this.pressedOrder()) map[p.cell] = p.step;
    return map;
  });

  readonly canStart = computed(() => {
    const okId = this.subjectId().trim().length >= 2;
    return okId && this.trials() >= 1 && this.stepsNum() >= 1 && this.studySeconds() >= 1;
  });

  constructor() {
    // Ensure no timers leak between screens
    effect(() => {
      const s = this.screen();
      if (s !== 'run') {
        this._stopTimer();
        this._stopAllAudio();
        this.picPickerOpen.set(false);
        this.locPickerOpen.set(false);
      }
    });

    // Keep per-trial sequence arrays in sync with Trials + StepsNum.
    effect(() => {
      // reading signals establishes deps
      const t = Math.max(1, Math.min(50, this.trials()));
      const steps = Math.max(1, Math.min(5, this.stepsNum()));
      const task = this.taskType();
      if (task === this.TaskType.Picture) {
        const cur = untracked(() => this.pictureSequences());
        this.pictureSequences.set(this._normalizeSequences(cur, t, steps, 1, 99));
      } else {
        const cur = untracked(() => this.locationSequences());
        this.locationSequences.set(this._normalizeSequences(cur, t, steps, 1, 16));
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
    this.pressedOrder.set([]);
    this.feedback.set(null);
    this.showCongrats.set(false);
    this.locTestPics.set({});
    this.trialStartedAt = performance.now();
    this.screen.set('run');
    this._runStudyTick();
  }

  private _runStudyTick() {
    this._stopTimer();
    this.phase.set('study');
    this.feedback.set(null);
    this.countdown.set(this.studySeconds());
    if (this.taskType() === this.TaskType.Location) {
      this.locStudyPicId.set(this._randPic());
    }

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
    this.pressedOrder.set([]);
    this.feedback.set(null);
    if (this.taskType() === this.TaskType.Location) {
      // Assign random pictures to each visible location cell for this trial's test phase.
      const choices = this.testChoices();
      const mapping: Record<number, number> = {};
      const studyPic = this.locStudyPicId();
      const targets = new Set(this.currentSequence());
      for (const cell of choices) {
        if (targets.has(cell)) {
          // Ensure targets do not use the same picture as the study phase.
          mapping[cell] = this._randPic(new Set([studyPic]));
        } else {
          // Distractors may (or may not) match the study picture; allow it naturally.
          mapping[cell] = this._randPic();
        }
      }
      this.locTestPics.set(mapping);
    }
    this._stopTimer();
  }

  onPick(choice: number) {
    if (this.phase() !== 'test') return;
    const presses = this.pressed();
    const expected = this.expectedNext();

    // Ignore repeats unless it is the next expected step (handles 13,13 sequences).
    if (presses.includes(choice) && choice !== expected) return;

    const ok = choice === expected;
    this.feedback.set(ok ? 'correct' : 'wrong');
    this._play(ok ? 'correct' : 'wrong');

    if (!ok) {
      // brief feedback then clear
      window.setTimeout(() => this.feedback.set(null), 450);
      return;
    }

    const next = [...presses, choice];
    this.pressed.set(next);
    this.pressedOrder.set([...this.pressedOrder(), { cell: choice, step: next.length }]);
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
      this._stopAllAudio();
      this.phase.set('done');
      this.screen.set('results');
      return;
    }
    this.trialIndex.set(t);
    this.phase.set('study');
    this.stepIndex.set(0);
    this.pressed.set([]);
    this.pressedOrder.set([]);
    this.feedback.set(null);
    this.locTestPics.set({});
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
    this._stopAllAudio();
    const audio = new Audio(map[name]);
    audio.volume = name === 'success' ? 0.75 : 0.9;
    audio.currentTime = 0;
    this.activeAudio = [audio];
    void audio.play().catch(() => {});
    if (name === 'success') {
      // Cap applause length so it doesn't linger after completion
      window.setTimeout(() => this._stopAllAudio(), 2200);
    }
  }

  private _stopAllAudio() {
    for (const a of this.activeAudio) {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {}
    }
    this.activeAudio = [];
  }

  // UI helpers
  isLocationCellActive(cell: number) {
    if (this.taskType() !== this.TaskType.Location) return false;
    const seq = this.currentSequence();
    if (this.phase() === 'study') return seq[this.stepIndex()] === cell;
    if (this.phase() !== 'test') return false;
    // During test, do not auto-highlight the correct answer.
    return false;
  }

  isChoiceSelected(choice: number) {
    return this.pressed().includes(choice);
  }

  pad3(n: number) {
    const x = Math.max(0, Math.floor(n));
    return x.toString().padStart(3, '0');
  }

  private _randPic(avoid: Set<number> = new Set()) {
    // pics are 1..99
    for (let i = 0; i < 40; i++) {
      const r = 1 + Math.floor(Math.random() * 99);
      if (!avoid.has(r)) return r;
    }
    // fallback
    for (let r = 1; r <= 99; r++) if (!avoid.has(r)) return r;
    return 1;
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

  openPicPicker(trialIdx: number, stepIdx: number) {
    this.picPickerTrial.set(trialIdx);
    this.picPickerStep.set(stepIdx);
    this.picPickerOpen.set(true);
  }

  closePicPicker() {
    this.picPickerOpen.set(false);
  }

  pickPic(pid: number) {
    const ti = this.picPickerTrial();
    const si = this.picPickerStep();
    this.setPictureStep(ti, si, String(pid));
    this.picPickerOpen.set(false);
  }

  isPicDisabledInTrial(trialIdx: number, stepIdx: number, pid: number) {
    const row = this.pictureSequences()[trialIdx] ?? [];
    for (let i = 0; i < row.length; i++) {
      if (i !== stepIdx && row[i] === pid) return true;
    }
    return false;
  }

  openLocPicker(trialIdx: number, stepIdx: number) {
    this.locPickerTrial.set(trialIdx);
    this.locPickerStep.set(stepIdx);
    this.locPickerOpen.set(true);
  }

  closeLocPicker() {
    this.locPickerOpen.set(false);
  }

  pickLoc(cell: number) {
    const ti = this.locPickerTrial();
    const si = this.locPickerStep();
    this.setLocationStep(ti, si, String(cell));
    this.locPickerOpen.set(false);
  }

  isLocDisabledInTrial(trialIdx: number, stepIdx: number, cell: number) {
    const row = this.locationSequences()[trialIdx] ?? [];
    for (let i = 0; i < row.length; i++) {
      if (i !== stepIdx && row[i] === cell) return true;
    }
    return false;
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
