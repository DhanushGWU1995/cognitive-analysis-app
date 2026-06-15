import { CommonModule } from '@angular/common';
import { Component, computed, effect, signal, untracked } from '@angular/core';
import * as XLSX from 'xlsx';

type TrialTouch = {
  press: number;
  ms: number;
  choice: number;
  gridCell: number;
  expected: number;
  correct: boolean;
  ignored: boolean;
  automatic: boolean;
};

type TrialResult = {
  trial: number;
  taskType: 'location' | 'picture';
  testMode: string;
  isDemo: boolean;
  sequence: number[];
  presses: number[];
  touches: TrialTouch[];
  correct: boolean;
  ms: number;
  trialSessionStartMs: number;
  locTrialPic?: number;
  listNum: number;
};

/** SELeCT legacy report columns (matches report_template.txt + ListNum before SequenceBy). */
const LEGACY_REPORT_HEADER = [
  'Sub',
  'Date',
  'Press',
  'Trial',
  '',
  'SequenceBy',
  'ItemPressed',
  'CorrectItem',
  'Progress',
  'PressAccuracy',
  'TrialAccuracy',
  'RT',
  'SessionTime',
  'ListNum',
  'ListPics',
  'ListLocations',
  'TrialsNum',
  'TotalTrialsNum',
  'StepsNum',
  'TO',
  'ITI',
  'DistractorsEnable',
  'BlackBorder',
  'PlaySound',
  'FreeRecall',
  'TapMode',
  'ProgressCorrectOnly',
  'Automatic',
  'DemonstrationNum',
  '',
  'Notes',
] as const;

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
                <div class="t">Spatial Task</div>
                <div class="d">Remember locations.</div>
              </div>
            </button>
            <button class="big-btn" (click)="goSetup(TaskType.Picture)">
              <div class="emoji">🖼️</div>
              <div class="txt">
                <div class="t">Object Task</div>
                <div class="d">Remember pictures.</div>
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
          <p class="muted">Task: <b>{{ taskTitle() }}</b> — {{ taskTagline() }}</p>

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

          <div class="test-mode-picker">
            <h2>Test mode</h2>
            <p class="muted small">Applies to Spatial and Object tasks. Pick a preset, then fine-tune below if needed.</p>
            <div class="test-mode-options">
              <label class="test-mode-card" [class.selected]="testMode() === TestMode.Standard">
                <input
                  type="radio"
                  name="testMode"
                  [checked]="testMode() === TestMode.Standard"
                  (change)="setTestMode(TestMode.Standard)"
                />
                <span class="test-mode-title">(A) Standard test</span>
                <span class="test-mode-desc">Border + correct sound on right taps. Wrong sound, grid clears, next trial on error.</span>
              </label>
              <label class="test-mode-card" [class.selected]="testMode() === TestMode.FreeRecall">
                <input
                  type="radio"
                  name="testMode"
                  [checked]="testMode() === TestMode.FreeRecall"
                  (change)="setTestMode(TestMode.FreeRecall)"
                />
                <span class="test-mode-title">(B) Free recall</span>
                <span class="test-mode-desc">Border + neutral sound on every tap. No right/wrong feedback.</span>
              </label>
              <label class="test-mode-card" [class.selected]="testMode() === TestMode.AdvanceWhenCorrect">
                <input
                  type="radio"
                  name="testMode"
                  [checked]="testMode() === TestMode.AdvanceWhenCorrect"
                  (change)="setTestMode(TestMode.AdvanceWhenCorrect)"
                />
                <span class="test-mode-title">(C) Advance when correct</span>
                <span class="test-mode-desc">Wrong sound on errors. Trial continues until the sequence is correct.</span>
              </label>
            </div>
          </div>

          <div class="feedback-flags">
            <h2>Step feedback (Spatial and Object tasks)</h2>
            <p class="muted small">Shown on the grid after each correct tap during test.</p>
            <div class="flag-grid">
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="feedbackBorder()"
                  (change)="feedbackBorder.set($any($event.target).checked)"
                />
                <span>Border highlight</span>
              </label>
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="feedbackStepNumber()"
                  (change)="feedbackStepNumber.set($any($event.target).checked)"
                />
                <span>Step number</span>
              </label>
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="feedbackSmiley()"
                  (change)="feedbackSmiley.set($any($event.target).checked)"
                />
                <span>Happy face</span>
              </label>
            </div>
            <p class="muted small response-hint">Sound and Correct / Try again pill during test:</p>
            <div class="flag-grid">
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="feedbackEveryResponse()"
                  (change)="feedbackEveryResponse.set($any($event.target).checked)"
                />
                <span>Every response</span>
              </label>
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="feedbackEveryError()"
                  (change)="feedbackEveryError.set($any($event.target).checked)"
                />
                <span>Every wrong tap</span>
              </label>
            </div>
            <p class="muted small">
              Turn off <b>Every response</b> for first tap only. Turn off <b>Every wrong tap</b> to show Try again
              only on the first mistake.
            </p>
          </div>

          <div class="automatic-demo">
            <h2>Automatic demonstration</h2>
            <p class="muted small">
              On demo trials the computer highlights each correct step in order (border and sound always on). The
              teacher says “Watch!” — the child does not tap.
            </p>
            <div class="flag-grid">
              <label class="flag">
                <input
                  type="checkbox"
                  [checked]="automaticDemo()"
                  (change)="automaticDemo.set($any($event.target).checked)"
                />
                <span>Automatic watch trials</span>
              </label>
              <label>
                <div class="lbl">Demo trials (first N)</div>
                <input
                  type="number"
                  min="0"
                  [max]="trials()"
                  [value]="demoTrials()"
                  [disabled]="!automaticDemo()"
                  (input)="demoTrials.set(+$any($event.target).value)"
                />
              </label>
            </div>
          </div>

          <div class="seq-editor" *ngIf="taskType() === TaskType.Picture">
            <div class="seq-editor-head">
              <div>
                <h2>Object sequence</h2>
                <p class="muted small">
                  Pick a picture for each step (Object Task). StepsNum controls how many picks per trial.
                </p>
              </div>
              <div class="seq-tools">
                <label class="seq-toggle">
                  <input
                    type="checkbox"
                    [checked]="sameSequenceForAllTrials()"
                    (change)="setSameSequenceForAllTrials($any($event.target).checked)"
                  />
                  <span>Same sequence for all trials</span>
                </label>
                <button
                  type="button"
                  class="btn ghost seq-apply"
                  [disabled]="trials() <= 1"
                  (click)="applySequenceToAllTrials()"
                >
                  Apply trial 1 to all
                </button>
              </div>
            </div>

            <div class="seq-table">
              <div class="seq-row header">
                <div class="cell h">{{ sameSequenceForAllTrials() ? 'All trials' : 'Trial' }}</div>
                <div class="cell h" *ngFor="let _ of [].constructor(stepsNum()); let si = index">Step {{ si + 1 }}</div>
              </div>

              <ng-container *ngIf="sameSequenceForAllTrials(); else picturePerTrialRows">
                <div class="seq-row">
                  <div class="cell trial synced">★</div>
                  <div class="cell" *ngFor="let __ of [].constructor(stepsNum()); let si = index">
                    <button class="pick pick-visual" type="button" (click)="openPicPicker(0, si)">
                      <img
                        class="pick-thumb"
                        [src]="'assets/pics/' + pad3(pictureSequences()[0][si]) + '.jpg'"
                        alt=""
                        loading="lazy"
                      />
                      <span class="pick-label">{{ pad3(pictureSequences()[0][si]) }}</span>
                    </button>
                  </div>
                </div>
              </ng-container>
              <ng-template #picturePerTrialRows>
                <div class="seq-row" *ngFor="let _ of [].constructor(trials()); let ti = index">
                  <div class="cell trial">{{ ti + 1 }}</div>
                  <div class="cell" *ngFor="let __ of [].constructor(stepsNum()); let si = index">
                    <button class="pick pick-visual" type="button" (click)="openPicPicker(ti, si)">
                      <img
                        class="pick-thumb"
                        [src]="'assets/pics/' + pad3(pictureSequences()[ti][si]) + '.jpg'"
                        alt=""
                        loading="lazy"
                      />
                      <span class="pick-label">{{ pad3(pictureSequences()[ti][si]) }}</span>
                    </button>
                  </div>
                </div>
              </ng-template>
            </div>
          </div>

          <!-- Visual picture picker overlay -->
          <div class="picker-overlay" *ngIf="picPickerOpen()" (click)="closePicPicker()">
            <div class="picker" (click)="$event.stopPropagation()">
              <div class="picker-top">
                <div class="picker-title">
                  Pick object —
                  {{
                    sameSequenceForAllTrials()
                      ? 'All trials'
                      : 'Trial ' + (picPickerTrial() + 1)
                  }},
                  Step {{ picPickerStep() + 1 }}
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
            <div class="seq-editor-head">
              <div>
                <h2>Spatial sequence</h2>
                <p class="muted small">Pick a grid cell (1–16) for each step (Spatial Task). StepsNum controls how many picks per trial.</p>
              </div>
              <div class="seq-tools">
                <label class="seq-toggle">
                  <input
                    type="checkbox"
                    [checked]="sameSequenceForAllTrials()"
                    (change)="setSameSequenceForAllTrials($any($event.target).checked)"
                  />
                  <span>Same sequence for all trials</span>
                </label>
                <button
                  type="button"
                  class="btn ghost seq-apply"
                  [disabled]="trials() <= 1"
                  (click)="applySequenceToAllTrials()"
                >
                  Apply trial 1 to all
                </button>
              </div>
            </div>

            <div class="seq-table">
              <div class="seq-row header">
                <div class="cell h">{{ sameSequenceForAllTrials() ? 'All trials' : 'Trial' }}</div>
                <div class="cell h" *ngFor="let _ of [].constructor(stepsNum()); let si = index">Step {{ si + 1 }}</div>
              </div>

              <ng-container *ngIf="sameSequenceForAllTrials(); else locationPerTrialRows">
                <div class="seq-row">
                  <div class="cell trial synced">★</div>
                  <div class="cell" *ngFor="let __ of [].constructor(stepsNum()); let si = index">
                    <button class="pick pick-loc" type="button" (click)="openLocPicker(0, si)">
                      <span class="loc-pill">{{ locationSequences()[0][si] }}</span>
                      <span class="pick-label">Cell</span>
                    </button>
                  </div>
                </div>
              </ng-container>
              <ng-template #locationPerTrialRows>
                <div class="seq-row" *ngFor="let _ of [].constructor(trials()); let ti = index">
                  <div class="cell trial">{{ ti + 1 }}</div>
                  <div class="cell" *ngFor="let __ of [].constructor(stepsNum()); let si = index">
                    <button class="pick pick-loc" type="button" (click)="openLocPicker(ti, si)">
                      <span class="loc-pill">{{ locationSequences()[ti][si] }}</span>
                      <span class="pick-label">Cell</span>
                    </button>
                  </div>
                </div>
              </ng-template>
            </div>
          </div>

          <!-- Location picker overlay -->
          <div class="picker-overlay" *ngIf="locPickerOpen()" (click)="closeLocPicker()">
            <div class="picker" (click)="$event.stopPropagation()">
              <div class="picker-top">
                <div class="picker-title">
                  Pick location —
                  {{
                    sameSequenceForAllTrials()
                      ? 'All trials'
                      : 'Trial ' + (locPickerTrial() + 1)
                  }},
                  Step {{ locPickerStep() + 1 }}
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
            <div class="title" *ngIf="phase() === 'study'">{{ taskTitle() }}</div>
            <div class="subtitle" *ngIf="phase() === 'study'">{{ taskTagline() }}</div>
            <div class="meta" *ngIf="phase() === 'study'">
              {{ isSpatialTask() ? 'Location' : 'Picture' }} {{ stepIndex() + 1 }} of {{ trialSequence().length }} ·
              <span class="countdown">{{ countdown() }}</span>
            </div>

            <div class="study-ready" *ngIf="phase() === 'studyReady'">
              <div class="title">Study complete</div>
              <p class="subtitle">
                Ready for trial {{ trialIndex() + 1 }}? Continue to test, or watch the study sequence once more.
              </p>
              <div class="study-ready-actions">
                <button type="button" class="btn ghost" (click)="replayStudy()">Show study again</button>
                <button type="button" class="btn primary" (click)="continueToTest()">Continue to test</button>
              </div>
            </div>

            <div class="title" *ngIf="phase() === 'test' && automaticPlayback()">Watch!</div>
            <div class="title" *ngIf="phase() === 'test' && !automaticPlayback()">
              {{
                testMode() === TestMode.FreeRecall
                  ? (isSpatialTask() ? 'Touch each location!' : 'Touch each picture!')
                  : isSpatialTask()
                    ? 'Touch each location in order!'
                    : 'Touch each picture in order!'
              }}
            </div>
            <div class="subtitle" *ngIf="phase() === 'test' && automaticPlayback()">
              {{ isSpatialTask() ? 'Watch each location in order.' : 'Watch each picture in order.' }}
            </div>
            <div class="subtitle" *ngIf="phase() === 'test' && !automaticPlayback() && testMode() !== TestMode.FreeRecall">
              Step {{ pressed().length + 1 }} of {{ trialSequence().length }}
            </div>
            <div class="subtitle" *ngIf="phase() === 'test' && !automaticPlayback() && testMode() === TestMode.FreeRecall">
              Response {{ pressed().length + 1 }} of {{ trialSequence().length }}
            </div>
            <div
              class="step-progress"
              *ngIf="
                phase() === 'test' &&
                !showCongrats() &&
                testMode() !== TestMode.FreeRecall &&
                (feedbackStepNumber() || feedbackSmiley())
              "
            >
              <div
                class="step-badge"
                *ngFor="let _ of [].constructor(trialSequence().length); let i = index"
                [class.done]="i < pressed().length"
              >
                <span class="num" *ngIf="feedbackStepNumber()">{{ i + 1 }}</span>
                <span class="face" *ngIf="feedbackSmiley() && i < pressed().length">😊</span>
              </div>
            </div>
          </div>

          <div class="grid4">
            <button
              class="cell"
              *ngFor="let cell of gridCells"
              [class.active]="showBorderHighlight() && (isGridCellActive(cell) || isAutoHighlightCell(cell))"
              [class.border-flash]="showBorderHighlight() && isCellBorderFlashing(cell)"
              [class.dim]="isGridCellDim(cell)"
              [disabled]="isGridCellDisabled(cell)"
              (click)="onGridCellClick(cell)"
            >
              <div
                class="step-overlay"
                *ngIf="
                  phase() === 'test' &&
                  testMode() !== TestMode.FreeRecall &&
                  !showCongrats() &&
                  gridStepBadge(cell) &&
                  (feedbackStepNumber() || feedbackSmiley())
                "
              >
                <div class="step-overlay-cluster" aria-hidden="true">
                  <span class="step-num" *ngIf="feedbackStepNumber()" [class.badge-border]="feedbackBorder()">{{
                    gridStepBadge(cell)
                  }}</span>
                  <span class="step-face" *ngIf="feedbackSmiley()">😊</span>
                </div>
              </div>
              <ng-container *ngIf="showImageInGridCell(cell); else emptyCell">
                <img
                  class="pic"
                  [src]="'assets/pics/' + pad3(picIdInGridCell(cell)) + '.jpg'"
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

          <div class="feedback" *ngIf="feedback() && testMode() !== TestMode.FreeRecall">
            <div class="pill" [class.ok]="feedback() === 'correct'" [class.no]="feedback() === 'wrong'">
              {{ feedback() === 'correct' ? 'Correct!' : 'Try again' }}
            </div>
          </div>

          <button
            type="button"
            class="study-replay-fab"
            *ngIf="phase() === 'test' && !showCongrats() && !automaticPlayback()"
            (click)="teacherReplayStudy()"
          >
            Show study again
          </button>

        </section>

        <section class="card" *ngIf="screen() === 'results'">
          <h1>All finished!</h1>
          <p class="muted">Download a SELeCT-compatible Excel report (one row per press).</p>
          <div class="actions">
            <button class="btn ghost" (click)="screen.set('home')">New session</button>
            <button class="btn primary" (click)="downloadReport()">Download Report</button>
          </div>
          <div class="mini">Completed: {{ results().length }} / {{ trials() }} trial(s)</div>
        </section>
      </main>

      <div
        class="congrats"
        *ngIf="screen() === 'run' && showCongrats()"
        role="dialog"
        aria-live="polite"
        aria-label="Congratulations"
      >
        <div class="congrats-backdrop"></div>
        <div class="congrats-card">
          <div class="congrats-orbit" aria-hidden="true">
            <span class="orbit-item o1">✨</span>
            <span class="orbit-item o2">⭐</span>
            <span class="orbit-item o3">🎊</span>
            <span class="orbit-item o4">🌟</span>
            <span class="orbit-item o5">✨</span>
            <span class="orbit-item o6">🎉</span>
          </div>
          <div class="congrats-hero">🎉</div>
          <div class="congrats-video-wrap">
            <video
              class="congrats-video"
              src="assets/video/congrats.mp4"
              autoplay
              muted
              playsinline
              preload="auto"
            ></video>
          </div>
          <h2 class="congrats-title">You did it!</h2>
          <p class="congrats-sub">Great job — keep going!</p>
        </div>
      </div>
    </div>
  `,
  styleUrl: './app.component.scss'
})
export class AppComponent {
  readonly TaskType = {
    Location: 'location',
    Picture: 'picture',
  } as const;

  readonly TestMode = {
    Standard: 'standard',
    FreeRecall: 'freeRecall',
    AdvanceWhenCorrect: 'advanceWhenCorrect',
  } as const;

  readonly screen = signal<'home' | 'setup' | 'run' | 'results'>('home');
  readonly taskType = signal<(typeof this.TaskType)[keyof typeof this.TaskType]>(this.TaskType.Location);

  // Session setup
  readonly subjectId = signal('kid001');
  readonly trials = signal(5);
  readonly totalTrialsNum = signal(5);
  readonly stepsNum = signal(2);
  readonly distractorsN = signal(1);
  readonly studySeconds = signal(5);
  /** Correct-step feedback toggles (location + picture test). */
  readonly feedbackBorder = signal(true);
  readonly feedbackStepNumber = signal(true);
  readonly feedbackSmiley = signal(true);
  /** Sound + pill on every tap (correct and wrong). If false, only the first tap gets them. */
  readonly feedbackEveryResponse = signal(true);
  /** Sound + Try again on every wrong tap. If false, only the first wrong tap per trial. */
  readonly feedbackEveryError = signal(true);
  readonly testMode = signal<(typeof this.TestMode)[keyof typeof this.TestMode]>(
    this.TestMode.AdvanceWhenCorrect,
  );
  /** When true, one sequence row applies to every trial (trial 1 is the master). */
  readonly sameSequenceForAllTrials = signal(false);
  /** First N trials: computer highlights the answer; child watches (no taps). */
  readonly automaticDemo = signal(false);
  readonly demoTrials = signal(0);

  // Runtime
  readonly trialIndex = signal(0);
  readonly phase = signal<'study' | 'studyReady' | 'test' | 'done'>('study');
  /** Frozen target sequence for the active trial (prevents order drift mid-trial). */
  readonly trialSequence = signal<number[]>([]);
  /** Location test: which cells are visible this trial (set once when test starts). */
  readonly trialTestCells = signal<number[]>([]);
  readonly stepIndex = signal(0); // within-trial sequence step
  readonly countdown = signal(0);
  readonly pressed = signal<number[]>([]);
  readonly pressedOrder = signal<Array<{ cell: number; step: number }>>([]);
  readonly feedback = signal<'correct' | 'wrong' | null>(null);
  readonly showCongrats = signal(false);
  /** True after the teacher continues from study-ready into test for the current trial. */
  readonly sessionStudyDone = signal(false);
  /** Teacher replayed study mid-test; return to test without resetting the trial. */
  private studyReturnToTest = signal(false);
  /** Spatial task: one identical filler picture for the whole trial (study + test). */
  readonly locTrialPicId = signal(1);
  /** Picture task: random grid cell per study step (1–16). */
  readonly picStudyCellByStep = signal<number[]>([]);
  /** Picture task: test phase cell -> picture id. */
  readonly picTestCellToPic = signal<Record<number, number>>({});

  readonly gridCells = Array.from({ length: 16 }, (_, i) => i + 1);

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

  readonly results = signal<TrialResult[]>([]);

  /** Every tap during the active trial (including wrong, ignored, and automatic demo steps). */
  readonly trialTouches = signal<TrialTouch[]>([]);
  readonly automaticPlayback = signal(false);
  readonly autoHighlightCell = signal<number | null>(null);

  private trialStartedAt = 0;
  private sessionStartedAt = 0;
  private testPhaseStartedAt = 0;
  private trialSessionStartMs = 0;
  private sessionDate = new Date();
  private trialTapCount = 0;
  private trialWrongCount = 0;
  private timer: number | null = null;
  private congratsTimer: number | null = null;
  private activeAudio: HTMLAudioElement[] = [];
  private borderFlashTimers = new Map<number, number>();
  private autoDemoTimer: number | null = null;
  /** Grid cells showing a short-lived border after a tap (clears after ~2s). */
  readonly borderFlashCells = signal<Set<number>>(new Set());

  readonly isDemoTrial = computed(
    () => this.automaticDemo() && this.trialIndex() < Math.max(0, Math.min(this.trials(), this.demoTrials())),
  );

  /** Border on for user setting, or always during automatic watch playback (no sound there). */
  readonly showBorderHighlight = computed(() => this.feedbackBorder() || this.automaticPlayback());

  // Picture picker overlay (visual selection)
  readonly picPickerOpen = signal(false);
  readonly picPickerTrial = signal(0);
  readonly picPickerStep = signal(0);
  // Location picker overlay (4x4 grid selection)
  readonly locPickerOpen = signal(false);
  readonly locPickerTrial = signal(0);
  readonly locPickerStep = signal(0);

  readonly expectedNext = computed(() => {
    const seq = this.trialSequence();
    const k = Math.min(this.pressed().length, seq.length - 1);
    return seq[k];
  });

  readonly pressedBadges = computed(() => {
    // Location task: map cell -> last completed step number (handles repeats by showing latest)
    const map: Record<number, number> = {};
    for (const p of this.pressedOrder()) map[p.cell] = p.step;
    return map;
  });

  /** Picture task: map picture id -> last completed step (same pressedOrder, cell holds pic id). */
  readonly pressedBadgesPic = computed(() => {
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
        this._stopAutoDemo();
        this._stopAllAudio();
        this.picPickerOpen.set(false);
        this.locPickerOpen.set(false);
      }
    });

    // Keep per-trial sequence arrays in sync with Trials + StepsNum (setup only).
    effect(() => {
      if (this.screen() !== 'setup') return;
      const t = Math.max(1, Math.min(50, this.trials()));
      const steps = Math.max(1, Math.min(5, this.stepsNum()));
      const task = this.taskType();
      const syncAll = this.sameSequenceForAllTrials();
      if (task === this.TaskType.Picture) {
        const cur = untracked(() => this.pictureSequences());
        let next = this._normalizeSequences(cur, t, steps, 1, 99);
        if (syncAll) next = this._syncAllTrialsToMaster(next);
        this.pictureSequences.set(next);
      } else {
        const cur = untracked(() => this.locationSequences());
        let next = this._normalizeSequences(cur, t, steps, 1, 16);
        if (syncAll) next = this._syncAllTrialsToMaster(next);
        this.locationSequences.set(next);
      }
    });
    this.setTestMode(this.testMode());
  }

  setTestMode(mode: (typeof this.TestMode)[keyof typeof this.TestMode]) {
    this.testMode.set(mode);
    switch (mode) {
      case this.TestMode.Standard:
        this.feedbackBorder.set(true);
        this.feedbackStepNumber.set(false);
        this.feedbackSmiley.set(false);
        this.feedbackEveryResponse.set(true);
        this.feedbackEveryError.set(true);
        break;
      case this.TestMode.FreeRecall:
        this.feedbackBorder.set(true);
        this.feedbackStepNumber.set(false);
        this.feedbackSmiley.set(false);
        this.feedbackEveryResponse.set(true);
        this.feedbackEveryError.set(false);
        break;
      case this.TestMode.AdvanceWhenCorrect:
        this.feedbackBorder.set(false);
        this.feedbackStepNumber.set(false);
        this.feedbackSmiley.set(false);
        this.feedbackEveryResponse.set(true);
        this.feedbackEveryError.set(true);
        break;
    }
  }

  goSetup(type: 'location' | 'picture') {
    this.taskType.set(type);
    this.sameSequenceForAllTrials.set(false);
    this.screen.set('setup');
  }

  taskTitle() {
    return this.isSpatialTask() ? 'Spatial Task' : 'Object Task';
  }

  taskTagline() {
    return this.isSpatialTask() ? 'Remember locations' : 'Remember pictures';
  }

  isSpatialTask() {
    return this.taskType() === this.TaskType.Location;
  }

  setSameSequenceForAllTrials(on: boolean) {
    this.sameSequenceForAllTrials.set(on);
    if (on) this.applySequenceToAllTrials();
  }

  applySequenceToAllTrials() {
    if (this.taskType() === this.TaskType.Picture) {
      const t = Math.max(1, this.trials());
      const steps = Math.max(1, this.stepsNum());
      const next = this._syncAllTrialsToMaster(
        this._normalizeSequences(this.pictureSequences(), t, steps, 1, 99),
      );
      this.pictureSequences.set(next);
    } else {
      const t = Math.max(1, this.trials());
      const steps = Math.max(1, this.stepsNum());
      const next = this._syncAllTrialsToMaster(
        this._normalizeSequences(this.locationSequences(), t, steps, 1, 16),
      );
      this.locationSequences.set(next);
    }
  }

  private _syncAllTrialsToMaster(seqs: number[][]) {
    if (!seqs.length) return seqs;
    const master = [...seqs[0]];
    return seqs.map(() => [...master]);
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
    this._clearBorderFlashes();
    this.sessionStudyDone.set(false);
    this.locTrialPicId.set(1);
    this.picTestCellToPic.set({});
    this.trialTestCells.set([]);
    this.trialTouches.set([]);
    this.sessionDate = new Date();
    this.sessionStartedAt = performance.now();
    this._beginTrial();
    this.trialStartedAt = performance.now();
    this.screen.set('run');
    this._runStudyTick();
  }

  replayStudy() {
    if (this.phase() !== 'studyReady') return;
    this._startStudyPlayback();
  }

  teacherReplayStudy() {
    if (this.phase() !== 'test' || this.showCongrats()) return;
    this.studyReturnToTest.set(true);
    this._startStudyPlayback();
  }

  continueToTest() {
    if (this.phase() !== 'studyReady') return;
    this.sessionStudyDone.set(true);
    this._enterTestPhase();
  }

  private _startStudyPlayback() {
    this._stopTimer();
    this.stepIndex.set(0);
    this.phase.set('study');
    this.feedback.set(null);
    if (this.taskType() === this.TaskType.Picture) {
      this._buildPicStudyLayout();
    }
    this._runStudyTick();
  }

  private _beginTrial() {
    const t = this.trialIndex();
    const seqs =
      this.taskType() === this.TaskType.Location ? this.locationSequences() : this.pictureSequences();
    const row = seqs[Math.min(t, seqs.length - 1)] ?? [];
    const seq = (row.length ? row : [1]).slice(0, Math.max(1, this.stepsNum()));
    this.trialSequence.set([...seq]);
    this.picTestCellToPic.set({});
    this.trialTestCells.set([]);
    if (this.taskType() === this.TaskType.Picture) {
      this._buildPicStudyLayout();
    } else {
      this.picStudyCellByStep.set([]);
      this._buildLocTrialPic();
    }
  }

  private _enterTestPhase() {
    this.phase.set('test');
    this.stepIndex.set(0);
    this.pressed.set([]);
    this.pressedOrder.set([]);
    this.feedback.set(null);
    if (this.taskType() === this.TaskType.Location) {
      this.trialTestCells.set(this._buildLocationTestCells());
    } else {
      this._buildPicTestLayout();
    }
    this.trialTapCount = 0;
    this.trialWrongCount = 0;
    this.trialTouches.set([]);
    this.testPhaseStartedAt = performance.now();
    this.trialSessionStartMs = Math.max(0, Math.round(this.testPhaseStartedAt - this.sessionStartedAt));
    this._clearBorderFlashes();
    this._stopTimer();
    if (this.isDemoTrial()) {
      window.setTimeout(() => this._runAutomaticDemo(), 450);
      return;
    }
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
    const seq = this.trialSequence();
    if (step + 1 < seq.length) {
      this.stepIndex.set(step + 1);
      this._runStudyTick();
      return;
    }
    this._stopTimer();
    this.stepIndex.set(0);
    if (this.studyReturnToTest()) {
      this.studyReturnToTest.set(false);
      this.phase.set('test');
      return;
    }
    this.phase.set('studyReady');
  }

  onPick(choice: number, tappedCell: number) {
    if (this.phase() !== 'test' || this.automaticPlayback()) return;
    this._handleTestTap(Number(choice), tappedCell);
  }

  private _handleTestTap(choiceId: number, tappedCell: number) {
    const expected = Number(this.expectedNext());
    const presses = this.pressed();
    const isFreeRecall = this.testMode() === this.TestMode.FreeRecall;
    const ignored = this._shouldIgnoreRepeatTap(choiceId, expected);

    this._appendTouch({
      press: this.trialTouches().length + 1,
      ms: this._touchElapsedMs(),
      choice: choiceId,
      gridCell: tappedCell,
      expected,
      correct: choiceId === expected,
      ignored,
      automatic: false,
    });

    if (ignored) return;

    this.trialTapCount++;
    const isFirstTap = this.trialTapCount === 1;
    const ok = choiceId === expected;
    const isFirstWrong = !ok && this.trialWrongCount === 0;
    const giveFeedback = !isFreeRecall && this._shouldGiveFeedback(ok, isFirstTap, isFirstWrong);

    if (giveFeedback && this.feedbackBorder()) {
      this._flashCellBorder(tappedCell);
    }

    if (!ok && this.testMode() === this.TestMode.Standard) {
      this.trialWrongCount++;
      if (giveFeedback) {
        this.feedback.set('wrong');
        this._play('wrong');
        window.setTimeout(() => this.feedback.set(null), 450);
      } else {
        this._play('wrong');
      }
      this._failTrialAndAdvance();
      return;
    }

    if (!isFreeRecall && giveFeedback) {
      this.feedback.set(ok ? 'correct' : 'wrong');
      this._play(ok ? 'correct' : 'wrong');
    } else if (isFreeRecall && giveFeedback) {
      this._play('neutral');
    }

    if (!ok) {
      this.trialWrongCount++;
      if (giveFeedback) {
        window.setTimeout(() => this.feedback.set(null), 450);
      }
      return;
    }

    this.feedback.set(null);
    const next = [...presses, choiceId];
    this.pressed.set(next);
    this.pressedOrder.set([...this.pressedOrder(), { cell: choiceId, step: next.length }]);
    if (this._isSequenceComplete(next)) {
      this._completeTrial(next);
    } else if (giveFeedback) {
      window.setTimeout(() => this.feedback.set(null), 450);
    }
  }

  private _isSequenceComplete(presses: number[]) {
    const seq = this.trialSequence();
    return presses.length === seq.length && presses.every((value, index) => Number(value) === Number(seq[index]));
  }

  private _appendTouch(touch: TrialTouch) {
    this.trialTouches.set([...this.trialTouches(), touch]);
  }

  private _completeTrial(presses: number[]) {
    const ms = Math.max(0, Math.round(performance.now() - this.trialStartedAt));
    const correct = this._isSequenceComplete(presses);
    this._recordTrialResult(presses, correct, ms, this.isDemoTrial());

    if (!correct) return;

    this._play('success');
    this._congratsBurst();
    window.setTimeout(() => this._nextTrialOrDone(), 900);
  }

  private _failTrialAndAdvance() {
    const presses = this.pressed();
    const ms = Math.max(0, Math.round(performance.now() - this.trialStartedAt));
    this._recordTrialResult(presses, false, ms, this.isDemoTrial());
    this._hideTestGrid();
    window.setTimeout(() => this._nextTrialOrDone(), 700);
  }

  private _recordTrialResult(presses: number[], correct: boolean, ms: number, isDemo: boolean) {
    this.results.set([
      ...this.results(),
      {
        trial: this.trialIndex() + 1,
        taskType: this.taskType(),
        testMode: this.testMode(),
        isDemo,
        sequence: [...this.trialSequence()],
        presses,
        touches: [...this.trialTouches()],
        correct,
        ms,
        trialSessionStartMs: this.trialSessionStartMs,
        locTrialPic: this.taskType() === this.TaskType.Location ? this.locTrialPicId() : undefined,
        listNum: this._listNumForTrial(this.trialIndex()),
      },
    ]);
  }

  private _runAutomaticDemo() {
    if (this.phase() !== 'test' || !this.isDemoTrial()) return;

    const seq = this.trialSequence().map((id) => Number(id));
    this.automaticPlayback.set(true);
    this.autoHighlightCell.set(null);
    this.pressed.set([]);
    this.pressedOrder.set([]);
    this.feedback.set(null);
    this._clearBorderFlashes();

    let step = 0;
    const stepMs = Math.max(800, this.studySeconds() * 1000);

    const playStep = () => {
      if (step >= seq.length) {
        this.automaticPlayback.set(false);
        this.autoHighlightCell.set(null);
        const presses = [...seq];
        this.pressed.set(presses);
        this.pressedOrder.set(presses.map((cell, index) => ({ cell, step: index + 1 })));
        this._completeTrial(presses);
        return;
      }

      const item = seq[step];
      const cell = this._gridCellForItem(item);
      if (cell == null) {
        step++;
        playStep();
        return;
      }

      this.autoHighlightCell.set(cell);
      this._flashCellBorder(cell);
      this._playAutomaticStepSound();

      this._appendTouch({
        press: this.trialTouches().length + 1,
        ms: this._touchElapsedMs(),
        choice: item,
        gridCell: cell,
        expected: item,
        correct: true,
        ignored: false,
        automatic: true,
      });

      step++;
      this.autoDemoTimer = window.setTimeout(() => {
        this.autoHighlightCell.set(null);
        this.autoDemoTimer = window.setTimeout(playStep, 280);
      }, stepMs);
    };

    playStep();
  }

  private _gridCellForItem(item: number): number | null {
    if (this.taskType() === this.TaskType.Location) {
      return this.trialTestCells().includes(item) ? item : null;
    }
    const map = this.picTestCellToPic();
    for (const [cellKey, picId] of Object.entries(map)) {
      if (Number(picId) === item) return Number(cellKey);
    }
    return null;
  }

  private _stopAutoDemo() {
    if (this.autoDemoTimer != null) {
      window.clearTimeout(this.autoDemoTimer);
      this.autoDemoTimer = null;
    }
    this.automaticPlayback.set(false);
    this.autoHighlightCell.set(null);
  }

  private _hideTestGrid() {
    this.locTrialPicId.set(1);
    this.picTestCellToPic.set({});
    this.trialTestCells.set([]);
  }

  private _shouldGiveFeedback(isCorrect: boolean, isFirstTap: boolean, isFirstWrong: boolean) {
    if (this.feedbackEveryResponse()) return true;
    if (!isCorrect) return this.feedbackEveryError() || isFirstWrong;
    return isFirstTap;
  }

  /** Ignore re-tapping an already-used choice that is not the current expected step. */
  private _shouldIgnoreRepeatTap(choice: number, expected: number): boolean {
    if (choice === expected) return false;
    const presses = this.pressed();
    if (!presses.includes(choice)) return false;

    if (this.taskType() === this.TaskType.Picture) {
      const seq = this.trialSequence().map((id) => Number(id));
      const timesUsed = presses.filter((p) => p === choice).length;
      const timesRequiredByNow = seq.slice(0, presses.length + 1).filter((id) => id === choice).length;
      return timesUsed >= timesRequiredByNow;
    }

    return true;
  }

  private _flashCellBorder(cell: number) {
    const next = new Set(this.borderFlashCells());
    next.add(cell);
    this.borderFlashCells.set(next);

    const existing = this.borderFlashTimers.get(cell);
    if (existing != null) window.clearTimeout(existing);

    const timerId = window.setTimeout(() => {
      const updated = new Set(this.borderFlashCells());
      updated.delete(cell);
      this.borderFlashCells.set(updated);
      this.borderFlashTimers.delete(cell);
    }, 2000);
    this.borderFlashTimers.set(cell, timerId);
  }

  private _clearBorderFlashes() {
    for (const timerId of this.borderFlashTimers.values()) {
      window.clearTimeout(timerId);
    }
    this.borderFlashTimers.clear();
    this.borderFlashCells.set(new Set());
  }

  private _nextTrialOrDone() {
    this._stopAutoDemo();
    const t = this.trialIndex() + 1;
    if (t >= this.trials()) {
      this._stopAllAudio();
      this.phase.set('done');
      this.screen.set('results');
      return;
    }
    this.trialIndex.set(t);
    this.pressed.set([]);
    this.pressedOrder.set([]);
    this.feedback.set(null);
    this.showCongrats.set(false);
    this._clearBorderFlashes();
    this.sessionStudyDone.set(false);
    this.studyReturnToTest.set(false);
    this._beginTrial();
    this.trialStartedAt = performance.now();
    this._runStudyTick();
  }

  private _touchElapsedMs() {
    return Math.max(0, Math.round(performance.now() - this.testPhaseStartedAt));
  }

  private _legacyDate(d = this.sessionDate) {
    const y = d.getFullYear() % 100;
    return `${d.getMonth() + 1}/${d.getDate()}/${y}`;
  }

  /** Stimulus list number (increments every TrialsNum trials in long sessions). */
  private _listNumForTrial(trialIndex: number) {
    const block = Math.max(1, this.trials());
    return Math.floor(trialIndex / block) + 1;
  }

  private _correctProgress(presses: number[], sequence: number[]) {
    let progress = 0;
    for (const choice of presses) {
      if (progress < sequence.length && choice === sequence[progress]) {
        progress++;
      }
    }
    return progress;
  }

  /** Legacy Press column = 1-based sequence step being attempted at tap time. */
  private _legacyPressColumn(pressesBefore: number[], sequence: number[]) {
    return Math.min(this._correctProgress(pressesBefore, sequence) + 1, Math.max(1, sequence.length));
  }

  private _legacyPicFileName(id: number) {
    const stem = id >= 100 ? String(id) : this.pad3(id);
    return `${stem}.jpeg`;
  }

  private _legacyTimeStamp(d = new Date()) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }

  private _targetLetters(sequence: number[]) {
    const map: Record<number, string> = {};
    for (let i = 0; i < sequence.length; i++) {
      map[sequence[i]] = String.fromCharCode(65 + i);
    }
    return map;
  }

  private _legacyItemLabel(choice: number, taskType: 'location' | 'picture', letters: Record<number, string>) {
    if (taskType === 'location') return String(choice);
    return letters[choice] ?? `X${choice}`;
  }

  private _legacyListPics(trial: TrialResult) {
    if (trial.taskType === 'picture') {
      const seen = new Set<number>();
      const pics: number[] = [];
      for (const id of trial.sequence) {
        if (!seen.has(id)) {
          seen.add(id);
          pics.push(id);
        }
      }
      return pics.map((id) => this._legacyPicFileName(id)).join(',');
    }
    return this._legacyPicFileName(trial.locTrialPic ?? 1);
  }

  private _legacyListLocations(trial: TrialResult) {
    if (trial.taskType === 'location') {
      const seen = new Set<number>();
      const cells: number[] = [];
      for (const cell of trial.sequence) {
        if (!seen.has(cell)) {
          seen.add(cell);
          cells.push(cell);
        }
      }
      return cells.join(',');
    }
    return 'random';
  }

  private _legacySequenceBy(taskType: 'location' | 'picture') {
    return taskType === 'location' ? 'locations' : 'pictures';
  }

  private _legacyBool(value: boolean) {
    return value ? 'TRUE' : 'FALSE';
  }

  private _legacyTrialAccuracy(trialCorrect: boolean, isLastPress: boolean) {
    if (!trialCorrect) return 'FALSE';
    return isLastPress ? 'TRUE' : 'bl';
  }

  /** Session / test-mode flags written on every legacy report row. */
  private _legacySessionConfig(trial: TrialResult) {
    const freeRecall = trial.testMode === this.TestMode.FreeRecall;
    const progressCorrectOnly = trial.testMode === this.TestMode.AdvanceWhenCorrect;
    return {
      iti: '1',
      playSound: true,
      freeRecall,
      tapMode: true,
      progressCorrectOnly,
      blackBorder: this.feedbackBorder(),
    };
  }

  private _buildLegacyReportRows(): string[][] {
    const subject = this.subjectId().trim();
    const date = this._legacyDate();
    const rows: string[][] = [LEGACY_REPORT_HEADER.slice()];

    for (const trial of this.results()) {
      const seq = trial.sequence;
      const letters = this._targetLetters(seq);
      const recordable = trial.touches.filter((t) => !t.ignored);
      const pressesSoFar: number[] = [];
      const notes = trial.isDemo ? 'demo' : '-';
      const listPics = this._legacyListPics(trial);
      const cfg = this._legacySessionConfig(trial);

      for (let i = 0; i < recordable.length; i++) {
        const touch = recordable[i];
        const pressesBefore = [...pressesSoFar];
        pressesSoFar.push(touch.choice);
        const progress = pressesSoFar
          .map((choice) => this._legacyItemLabel(choice, trial.taskType, letters))
          .join('');
        const isLast = i === recordable.length - 1;

        rows.push([
          subject,
          date,
          String(this._legacyPressColumn(pressesBefore, seq)),
          String(trial.trial),
          String(trial.listNum),
          this._legacySequenceBy(trial.taskType),
          this._legacyItemLabel(touch.choice, trial.taskType, letters),
          this._legacyItemLabel(touch.expected, trial.taskType, letters),
          progress,
          this._legacyBool(touch.correct),
          this._legacyTrialAccuracy(trial.correct, isLast),
          (touch.ms / 1000).toFixed(3),
          ((trial.trialSessionStartMs + touch.ms) / 1000).toFixed(3),
          String(trial.listNum),
          listPics,
          this._legacyListLocations(trial),
          String(this.trials()),
          String(this.totalTrialsNum()),
          String(this.stepsNum()),
          String(this.studySeconds()),
          cfg.iti,
          this._legacyBool(this.distractorsN() > 0),
          this._legacyBool(cfg.blackBorder),
          this._legacyBool(cfg.playSound),
          this._legacyBool(cfg.freeRecall),
          this._legacyBool(cfg.tapMode),
          this._legacyBool(cfg.progressCorrectOnly),
          this._legacyBool(this.automaticDemo() && trial.isDemo),
          String(this.demoTrials()),
          '',
          notes,
        ]);
      }
    }

    return rows;
  }

  downloadReport() {
    const rows = this._buildLegacyReportRows();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
    const subject = this.subjectId().trim() || 'subject';
    const date = this._legacyDate();
    const time = this._legacyTimeStamp();
    XLSX.writeFile(workbook, `SST-SCP${subject}_${date.replace(/\//g, '-')}_${time}.xlsx`);
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

  /** Neutral ding on each automatic watch step (independent of feedback toggles). */
  private _playAutomaticStepSound() {
    this._play('neutral');
  }

  private _play(name: 'correct' | 'wrong' | 'success' | 'neutral') {
    const map: Record<typeof name, string> = {
      correct: 'assets/sfx/ding2.mp3',
      wrong: 'assets/sfx/whoosh1.wav',
      success: 'assets/sfx/applause.mp3',
      neutral: 'assets/sfx/ding2.mp3',
    };
    this._stopAllAudio();
    const audio = new Audio(map[name]);
    const volume =
      name === 'success' ? 0.75 : name === 'neutral' ? 0.55 : 0.9;
    audio.volume = volume;
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

  // UI helpers — shared 4×4 grid (location + picture run screen)
  onGridCellClick(cell: number) {
    if (this.taskType() === this.TaskType.Location) {
      this.onPick(cell, cell);
      return;
    }
    const picId = this.picTestCellToPic()[cell];
    if (picId != null) this.onPick(picId, cell);
  }

  isCellBorderFlashing(cell: number) {
    return this.borderFlashCells().has(cell);
  }

  isAutoHighlightCell(cell: number) {
    return this.automaticPlayback() && this.autoHighlightCell() === cell;
  }

  isGridCellActive(cell: number) {
    if (this.phase() !== 'study') return false;
    if (this.taskType() === this.TaskType.Location) {
      return this.trialSequence()[this.stepIndex()] === cell;
    }
    return (this.picStudyCellByStep()[this.stepIndex()] ?? -1) === cell;
  }

  isGridCellDisabled(cell: number) {
    if (this.phase() !== 'test') return true;
    if (this.automaticPlayback()) return true;
    if (this.taskType() === this.TaskType.Location) {
      return !this.trialTestCells().includes(cell);
    }
    return this.picTestCellToPic()[cell] == null;
  }

  isGridCellDim(cell: number) {
    if (this.phase() !== 'test') return false;
    if (this.taskType() === this.TaskType.Location) {
      return !this.trialTestCells().includes(cell);
    }
    return this.picTestCellToPic()[cell] == null;
  }

  gridStepBadge(cell: number): number | null {
    if (this.phase() !== 'test') return null;
    if (this.taskType() === this.TaskType.Location) {
      return this.pressedBadges()[cell] ?? null;
    }
    const picId = this.picTestCellToPic()[cell];
    if (picId == null) return null;
    return this.pressedBadgesPic()[picId] ?? null;
  }

  showImageInGridCell(cell: number) {
    if (this.phase() === 'studyReady') return false;
    if (this.taskType() === this.TaskType.Location) {
      return (
        (this.phase() === 'study' && this.isGridCellActive(cell)) ||
        (this.phase() === 'test' && this.trialTestCells().includes(cell))
      );
    }
    if (this.phase() === 'study') return this.isGridCellActive(cell);
    return this.picTestCellToPic()[cell] != null;
  }

  picIdInGridCell(cell: number) {
    if (this.taskType() === this.TaskType.Location) {
      return this.locTrialPicId();
    }
    if (this.phase() === 'study') {
      return this.trialSequence()[this.stepIndex()] ?? 1;
    }
    return this.picTestCellToPic()[cell] ?? 1;
  }

  isChoiceSelected(choice: number) {
    return this.pressed().includes(choice);
  }

  private _buildLocTrialPic() {
    this.locTrialPicId.set(this._randPic());
  }

  private _buildPicStudyLayout() {
    const steps = this.trialSequence().length;
    this.picStudyCellByStep.set(this._pickRandomGridCells(steps, false));
  }

  private _buildLocationTestCells() {
    const seq = this.trialSequence();
    const n = Math.max(0, Math.min(12, this.distractorsN()));
    const targets: number[] = [];
    const seen = new Set<number>();
    for (const cell of seq) {
      if (!seen.has(cell)) {
        seen.add(cell);
        targets.push(cell);
      }
    }
    const out = [...targets];
    while (out.length < targets.length + n) {
      const r = 1 + Math.floor(Math.random() * 16);
      if (!out.includes(r)) out.push(r);
    }
    return out;
  }

  private _buildPicTestLayout() {
    const pics = this._testPictureIds();
    const cells = this._pickRandomGridCells(pics.length, true);
    const map: Record<number, number> = {};
    pics.forEach((pid, i) => {
      map[cells[i]] = pid;
    });
    this.picTestCellToPic.set(map);
  }

  private _testPictureIds() {
    const seq = this.trialSequence();
    const n = Math.max(0, Math.min(12, this.distractorsN()));
    const targets: number[] = [];
    const seen = new Set<number>();
    for (const id of seq) {
      if (!seen.has(id)) {
        seen.add(id);
        targets.push(id);
      }
    }
    const out = [...targets];
    while (out.length < targets.length + n) {
      const r = 1 + Math.floor(Math.random() * 99);
      if (!out.includes(r)) out.push(r);
    }
    return out;
  }

  /** Random cells 1–16; distinct=true requires unique cells (for test choices). */
  private _pickRandomGridCells(count: number, distinct: boolean) {
    const n = Math.max(0, Math.min(16, count));
    if (n === 0) return [];
    if (distinct) {
      const pool = Array.from({ length: 16 }, (_, i) => i + 1);
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, n);
    }
    return Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 16));
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
    let next = this._normalizeSequences(this.pictureSequences(), t, steps, 1, 99).map((row) => [...row]);
    if (!next[trialIdx]) return;
    next[trialIdx][stepIdx] = pic;
    if (this.sameSequenceForAllTrials()) next = this._syncAllTrialsToMaster(next);
    this.pictureSequences.set(next);
  }

  openPicPicker(trialIdx: number, stepIdx: number) {
    this.picPickerTrial.set(this.sameSequenceForAllTrials() ? 0 : trialIdx);
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
    this.locPickerTrial.set(this.sameSequenceForAllTrials() ? 0 : trialIdx);
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
    let next = this._normalizeSequences(this.locationSequences(), t, steps, 1, 16).map((row) => [...row]);
    if (!next[trialIdx]) return;
    next[trialIdx][stepIdx] = cell;
    if (this.sameSequenceForAllTrials()) next = this._syncAllTrialsToMaster(next);
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
