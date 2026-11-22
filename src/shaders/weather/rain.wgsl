struct RainParams {
  fallen: f32, // distance fallen so far, world units
  speed: f32,
  length: f32,
  width: f32,
  alpha: f32,
  top: f32,
  drift: f32, // sideways speed at wind strength 1
  snow: f32,  // 0 rain, 1 snow
  sway: f32,  // how far a flake wanders side to side, world units
}

struct VSOut {
  @builtin(position) clip: vec4f,
  @location(0) corner: vec2f,
}

@group(0) @binding(0) var<uniform> cam: Camera;
@group(0) @binding(1) var heightTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> rain: RainParams;
@group(0) @binding(3) var<uniform> wind: Wind;

@vertex
fn vs_main(@builtin(instance_index) i: u32, @builtin(vertex_index) v: u32) -> VSOut {
  let r = rand3(vec3u(i, 7u, 13u));
  let r2 = rand3(vec3u(i, 11u, 5u));
  let xz = (r.xy - 0.5) * WORLD_SIZE;
  let uv = r.xy;
  let ground = sampleHeight(heightTex, uv) * HEIGHT_SCALE;
  let span = rain.top - ground;

  // Each drop loops top -> ground; r.z is its phase so they are spread out.
  // Each one falls a little faster or slower than the rest, so they do not move as a sheet.
  let rate = mix(0.8, 1.2, r2.y);
  let fall = fract(r.z + rain.fallen * rate / span);
  let y = rain.top - fall * span;

  // The wind carries a drop sideways while it falls. xz is where it lands, so it starts
  // upwind of that, and the streak lies along its path.
  let drift = wind.dir * wind.strength * rain.drift;
  let path = normalize(vec3f(drift.x, -rain.speed * rate, drift.y));
  let toLand = drift * (1.0 - fall) * span / (rain.speed * rate);
  // Snow wanders slowly side to side on top of the wind; rain.sway is 0 for rain.
  let phase = r.z * 6.283;
  let sway = vec2f(sin(wind.time * 0.8 + phase), sin(wind.time * 0.5 + phase * 1.7)) * rain.sway;
  let head = vec3f(xz.x - toLand.x + sway.x, y, xz.y - toLand.y + sway.y);

  // Quad: 2 triangles, corner from the vertex index. x across, y back along the path.
  let corner = vec2f(f32(v & 1u), f32(v >= 2u && v <= 4u));   // (0,0) (1,0) (0,1) (1,1) (0,1) (1,0)
  let right = normalize(cross(path, cam.pos - head));
  // Flakes come in different sizes; raindrops all stay the same.
  let size = mix(1.0, mix(0.6, 1.4, r2.x), rain.snow);
  let pos = head + (right * (corner.x - 0.5) * rain.width - path * corner.y * rain.length) * size;

  var out: VSOut;
  out.clip = cam.viewProj * vec4f(pos, 1);
  out.corner = corner;          // corner.y 0 at the drop's head, 1 at the tail
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4f {
  // Rain: a streak that fades from head to tail.
  let rainA = rain.alpha * (1 - in.corner.y);
  let rainColor = vec3f(0.85, 0.9, 1.0);

  // Snow: a soft round dot.
  let d = distance(in.corner, vec2f(0.5));
  let snowA = 1.0 - smoothstep(0.3, 0.5, d);
  let snowColor = vec3f(0.95, 0.95, 0.95);

  let blendColor = mix(rainColor, snowColor, rain.snow);
  let a = mix(rainA, snowA * rain.alpha, rain.snow);
  return vec4f(blendColor, a);
}
