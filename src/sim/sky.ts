import type { GUI } from 'lil-gui';
import { device } from '../core/device';
import { createBuffer } from '../core/gpu';
import { SKY_COLOR } from '../core/layout';

type Look = { color: number[]; fogDensity: number; fogStart: number };

// One sky for the whole scene: the background, the fog that distant terrain fades
// into, the sky part of the ambient light and the water's reflection all read it.
export class Sky {
  params = {
    season: 0, // 0 spring, 1 winter. Stands in for the shared season until there is one.
  };
  // The two looks. update() blends every value between them by params.season.
  spring: Look = {
    color: [...SKY_COLOR],
    fogDensity: 0.002,
    fogStart: 60, // distance from the camera where fog begins, world units
  };
  winter: Look = {
    color: [0.8, 0.83, 0.87],
    fogDensity: 0.004,
    fogStart: 40,
  };
  // The blended sky color, linear. clearColor() is the same thing for the render pass.
  color = [...SKY_COLOR];
  // Sky in common.wgsl: color, fogDensity, fogStart + pad.
  readonly uniforms = createBuffer(GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 32);

  addGui(gui: GUI) {
    const folder = gui.addFolder('Sky');
    folder.add(this.params, 'season', 0, 1);
    for (const [name, look] of [['Spring', this.spring], ['Winter', this.winter]] as const) {
      const f = folder.addFolder(name).close();
      f.addColor(look, 'color');
      f.add(look, 'fogDensity', 0, 0.02);
      f.add(look, 'fogStart', 0, 120);
    }
  }

  update() {
    const t = this.params.season;
    const mix = (a: number, b: number) => a + (b - a) * t;
    this.color = this.spring.color.map((c, i) => mix(c, this.winter.color[i]));
    device.queue.writeBuffer(
      this.uniforms,
      0,
      new Float32Array([
        ...this.color,
        mix(this.spring.fogDensity, this.winter.fogDensity),
        mix(this.spring.fogStart, this.winter.fogStart),
      ]),
    );
  }

  // The canvas is not sRGB, so shaders apply gamma themselves; the clear color has to match.
  clearColor(): GPUColor {
    const [r, g, b] = this.color.map((c) => c ** (1 / 2.2));
    return { r, g, b, a: 1 };
  }
}
