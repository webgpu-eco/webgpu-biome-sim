import type { GUI } from 'lil-gui';
import { device, canvasFormat } from '../core/device';
import { camera } from '../core/camera';
import { HEIGHT_SCALE, MSAA_SAMPLES } from '../core/layout';
import { shaderModule } from '../core/gpu';
import { WIND_SPEED, type Wind } from './wind';
import rainWgsl from '../shaders/weather/rain.wgsl?raw';

// Matches the rainRate slider's upper bound in erosion_sim.ts; full slider = maxDrops * density.
const RAIN_RATE_MAX = 0.005;

export class Rain {
  maxDrops = 20000;
  // The two looks. update() blends every value between them by params.snow.
  rain = {
    speed: 25,
    length: 1.2,
    width: 0.04,
    alpha: 0.35,
    drift: 1,     // how much of the wind speed it picks up
    sway: 0,      // side to side wander, world units
    density: 1,   // count multiplier
  };
  snow = {
    speed: 3,
    length: 0.2,
    width: 0.2,
    alpha: 0.9,
    drift: 0.25,
    sway: 1,
    density: 1.2,   // flakes are small dots, so it takes more of them to read as snowfall
  };
  params = {
    snow: 0,                   // 0 rain, 1 snow
    top: HEIGHT_SCALE * 1.3,   // where drops start, world y
  };
  private count = 0;
  private fallen = 0;   // distance fallen so far; accumulated so changing speed does not make drops jump

  private uniforms: GPUBuffer;   // RainParams in rain.wgsl: fallen, speed, length, width, alpha, top, drift, snow, sway + pad
  private pipeline: GPURenderPipeline;
  private bindGroup: GPUBindGroup;

  constructor(height: GPUTexture, wind: Wind) {
    this.uniforms = device.createBuffer({
      size: 48,   // 9 f32 = 36 bytes, rounded up to a multiple of 16
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const module = shaderModule(rainWgsl);
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{
          format: canvasFormat,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
          },
        }],
      },
      primitive: { cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
      multisample: { count: MSAA_SAMPLES },
    });

    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: camera.uniformBuffer } },
        { binding: 1, resource: height.createView() },
        { binding: 2, resource: { buffer: this.uniforms } },
        { binding: 3, resource: { buffer: wind.uniforms } },
      ],
    });
  }

  addGui(gui: GUI) {
    const folder = gui.addFolder('Rain');
    folder.add(this.params, 'snow', 0, 1);

    const rain = folder.addFolder('Rain look');
    rain.add(this.rain, 'speed', 5, 60);
    rain.add(this.rain, 'length', 0.2, 4);
    rain.add(this.rain, 'width', 0.01, 0.2);
    rain.add(this.rain, 'alpha', 0, 1);

    const snow = folder.addFolder('Snow look');
    snow.add(this.snow, 'speed', 0.5, 10);
    snow.add(this.snow, 'length', 0.05, 1);
    snow.add(this.snow, 'width', 0.05, 0.5);
    snow.add(this.snow, 'alpha', 0, 1);
    snow.add(this.snow, 'drift', 0, 1);
    snow.add(this.snow, 'sway', 0, 3);
    snow.add(this.snow, 'density', 1, 5);
  }

  update(dt: number, rainRate: number) {
    const t = this.params.snow;
    const mix = (k: keyof typeof this.rain) => this.rain[k] + (this.snow[k] - this.rain[k]) * t;
    this.count = Math.round(Math.min(rainRate / RAIN_RATE_MAX, 1) * this.maxDrops * mix('density'));
    const speed = mix('speed');
    this.fallen += dt * speed;
    device.queue.writeBuffer(this.uniforms, 0, new Float32Array([
      this.fallen,
      speed,
      mix('length'),
      mix('width'),
      mix('alpha'),
      this.params.top,
      WIND_SPEED * mix('drift'),
      this.params.snow,
      mix('sway'),
    ]));
  }

  draw(pass: GPURenderPassEncoder) {
    if (this.count === 0) return;
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, this.count);
  }
}
