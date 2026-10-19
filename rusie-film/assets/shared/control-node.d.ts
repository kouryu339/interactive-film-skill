export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type CanvasLayer = 'background' | 'video' | 'portrait' | 'dialogue';
export interface CanvasPatch {
  asset?: string | null; source?: string | null; alt?: string;
  style?: Record<string, string>; text?: string; speaker?: string;
  lines?: { name?: string; text: string }[];
}
export interface CanvasAPI {
  set(layer: CanvasLayer, patch: CanvasPatch): Promise<void>;
  clear(layer: CanvasLayer): Promise<void>;
}
export interface CanvasEvent { layer: 'video'; phase: 'frame' | 'ended' | 'blocked' | 'error'; }
export interface NodeInput {
  readonly definition: Readonly<{
    id: string; kind: 'control'; inputs: Readonly<Record<string, Json>>;
    result: Readonly<Record<string, Json>>; choices: readonly Readonly<{ id: string; label: string }>[];
  }>;
  readonly resources: Readonly<{ component: string }>;
  readonly graph: Readonly<Record<string, Json>>;
  readonly role: Readonly<Record<string, Json>>;
  readonly state: Readonly<Record<string, Json>>;
  readonly config: Readonly<Record<string, Json>>;
  readonly checkpoint: Json;
  readonly history?: readonly Readonly<{ from: string; choice: string; to: string }>[];
}
export interface NodeBridge {
  readonly input: NodeInput;
  readonly canvas: CanvasAPI;
  complete(output: Record<string, Json>): Promise<void>;
  complete(outcome: string, result?: Record<string, Json>): Promise<void>;
  checkpoint(value: Json): Promise<void>;
  fail(message: string): Promise<void>;
  onControl(listener: (action: 'pause' | 'resume' | 'dispose') => void | Promise<void>): () => void;
  onCanvas(listener: (event: CanvasEvent) => void | Promise<void>): () => void;
}
export interface ChoiceView {
  id: string; label?: string; disabled?: boolean;
  event?: string; outcome?: string; output?: Record<string, Json>;
  [key: string]: unknown;
}
export interface InputView {
  id: string; label?: string; type?: string; value?: Json; required?: boolean;
  [key: string]: unknown;
}
export interface ControlView {
  styles?: string; choices?: ChoiceView[]; inputs?: InputView[];
  history?: Json[]; inventory?: Json[];
  [key: string]: unknown;
}
export class BaseNode {
  constructor(context: { api: NodeBridge; root: HTMLElement });
  static start<T extends BaseNode>(this: new (context: { api: NodeBridge; root: HTMLElement }) => T, options?: { root?: HTMLElement }): Promise<T>;
  readonly root: HTMLElement; readonly input: NodeInput; readonly definition: NodeInput['definition'];
  readonly paused: boolean; readonly disposed: boolean;
  readonly canvas: CanvasAPI;
  complete(output: Record<string, Json>): Promise<void>;
  complete(outcome: string, result: Record<string, Json>): Promise<void>;
  checkpoint(value: Json): Promise<void>;
  fire(name: string, payload?: unknown): Promise<unknown>;
  asset(relative: string): string;
  onStart(): void | Promise<void>;
  render(view?: ControlView): void | Promise<void>;
  onEvent(name: string, payload: unknown): unknown | Promise<unknown>;
  onCanvasEvent(event: CanvasEvent): unknown | Promise<unknown>;
  onPause(): void | Promise<void>; onResume(): void | Promise<void>; onDispose(): void | Promise<void>;
}
export class ControlNode extends BaseNode {
  view: ControlView; slots: Record<string, HTMLElement>;
  render(view?: ControlView): void;
  applyStyles(css: string): void;
  renderHistory(records: readonly Json[]): void;
  renderInventory(items: readonly Json[]): void;
  renderRecords(container: HTMLElement, records: readonly Json[]): void;
  renderInputs(fields: InputView[]): void;
  renderChoices(choices: ChoiceView[]): void;
  values(): Record<string, string | boolean>;
  onChoice(choice: ChoiceView, values: Record<string, string | boolean>): Promise<unknown>;
  onError(error: Error): void | Promise<void>;
}
