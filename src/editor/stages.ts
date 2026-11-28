import type { Sky } from '../sim/sky';
import type { Clouds } from '../sim/clouds';
import type { Rain } from '../sim/rain';

// The stage editor's model: the stages, what each one takes in, and where it comes from.
// stages_panel.ts draws it.

// The pipeline, top to bottom: the season sets the weather, weather falls on the terrain,
// the terrain decides what grows, and what grows is drawn as flowers.
export const NODES = ['Season', 'Weather', 'Erosion', 'Ecosystem', 'Flowers'] as const;
export type Node = (typeof NODES)[number];

// A value in 0..1 that an input can follow.
export type Source = {
  name: string;
  ends: [string, string]; // what 0 and 1 mean, for the labels
  value: () => number;
};

// How a number follows a source: target[key] moves between at0 and at1.
export type Mapping = {
  source: Source;
  target: Record<string, unknown>;
  key: string;
  at0: number; // target value when the source is 0
  at1: number; // target value when the source is 1
  range: [number, number];
  connected: boolean;
  // The ends are just "off" and "fully on" (0 and 1), so there is nothing worth editing.
  plain?: boolean;
};

// One thing a stage takes in. Connected, it comes from `from`; disconnected, the stage
// falls back to `fallback` (its own slider, the noise stub, nothing).
export type Input = {
  node: Node; // the stage that receives it
  from: string; // where it comes from when connected: another node, or a source inside this one
  label: string;
  fallback: string;
  isOn: () => boolean;
  set: (on: boolean) => void;
  mapping?: Mapping; // for numbers; other inputs are just on or off
  // A switch in the main GUI that shows the same state, kept in step with this one.
  mirror?: { object: object; property: string };
};

// What the editor needs from the track. Each stage only owns plain values and switches;
// nothing in them knows what drives them.
export type StageHooks = {
  sky: Sky;
  clouds: Clouds;
  rain: Rain;
  erosion: { rainRate: number };
  terrain: { isLive: () => boolean; setLive: (on: boolean) => void }; // erosion sim or noise stub
  plants: { showPlants: boolean };
};

export class Stages {
  season = {
    value: 0, // 0 spring, 1 winter. Stands in for the shared season until there is one.
    play: false,
    yearSeconds: 30, // spring -> winter -> spring
  };
  private phase = 0;
  readonly inputs: Input[];
  // Called when any input is connected or disconnected, from here or from the main GUI.
  onChange?: () => void;
  private state = '';

  constructor(h: StageHooks) {
    const season: Source = { name: 'Season', ends: ['spring', 'winter'], value: () => this.season.value };
    const cover: Source = { name: 'Cloud cover', ends: ['clear', 'overcast'], value: () => h.clouds.params.cover };

    const number = (
      node: Node, from: string, label: string, source: Source,
      target: Record<string, unknown>, key: string, at0: number, at1: number, range: [number, number],
      opts: { connected?: boolean; plain?: boolean } = {},
    ): Input => {
      const mapping: Mapping = { source, target, key, at0, at1, range, connected: opts.connected ?? true, plain: opts.plain };
      return {
        node, from, label, fallback: 'manual', mapping,
        isOn: () => mapping.connected,
        set: (on) => (mapping.connected = on),
      };
    };

    // Order matters: an input is computed after the ones above it, so cloud cover is
    // up to date by the time rain rate reads it.
    this.inputs = [
      number('Weather', 'Season', 'sky', season, h.sky.params, 'winter', 0, 1, [0, 1], { plain: true }),
      // Winter has more cloud, but thinner, so the terrain still shows.
      number('Weather', 'Season', 'cloud cover', season, h.clouds.params, 'cover', 0.4, 0.53, [0, 1]),
      number('Weather', 'Season', 'cloud alpha', season, h.clouds.params, 'alpha', 0.85, 0.75, [0, 1]),
      // Rain in spring, snow in winter, sleet in between.
      number('Weather', 'Season', 'snow', season, h.rain.params, 'snow', 0, 1, [0, 1], { plain: true }),
      // More cloud, more rain. At the spring cover of 0.4 this gives the sim's default 0.0003.
      // Off to start with: it changes how much water the erosion sim gets, and in winter that
      // water should be falling as snow, which nothing accumulates yet.
      number('Erosion', 'Weather', 'rain rate', cover, h.erosion, 'rainRate', 0.0001, 0.0006, [0, 0.005], { connected: false }),
      {
        node: 'Ecosystem', from: 'Erosion', label: 'terrain', fallback: 'noise stub',
        isOn: h.terrain.isLive, set: h.terrain.setLive,
      },
      {
        node: 'Flowers', from: 'Ecosystem', label: 'plants', fallback: 'none',
        isOn: () => h.plants.showPlants, set: (on) => (h.plants.showPlants = on),
        mirror: { object: h.plants, property: 'showPlants' },
      },
    ];
  }

  // Dragging the season by hand: keep auto-play in step (first half of the year).
  setSeason(v: number) {
    this.season.value = v;
    this.phase = Math.acos(1 - 2 * v) / (2 * Math.PI);
  }

  // Call before the stages update, so they read this frame's values.
  update(dt: number) {
    const s = this.season;
    if (s.play) {
      this.phase = (this.phase + dt / s.yearSeconds) % 1;
      s.value = 0.5 - 0.5 * Math.cos(this.phase * 2 * Math.PI);
    }
    for (const { mapping: m } of this.inputs) {
      if (!m?.connected) continue;
      // Rounded so the sliders that show it do not fill up with float noise.
      m.target[m.key] = +(m.at0 + (m.at1 - m.at0) * m.source.value()).toFixed(6);
    }
    // A switch can also be flipped from the main GUI (showPlants), so watch for changes.
    const state = this.inputs.map((i) => +i.isOn()).join('');
    if (state !== this.state) {
      this.state = state;
      this.onChange?.();
    }
  }
}
