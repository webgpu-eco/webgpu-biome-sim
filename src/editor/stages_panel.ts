import GUI, { type Controller } from 'lil-gui';
import { NODES, type Input, type Node, type Stages } from './stages';

// The stage editor's panel, top left: one card per stage with its inputs listed in full,
// and in the gap between two cards a clickable line for what flows from one to the next.
//
// This panel only says what is connected to what. The values themselves stay in the main
// GUI on the right; clicking a stage or an input here scrolls to its controls there.
//
// root: the main GUI, searched for the sliders the inputs drive, so call this after
// every stage has added its own.
// Where each stage's own controls are in the main GUI: folder titles, or the top level.
const CONTROLS: Record<Node, string[] | 'top'> = {
  Season: [],
  Weather: ['Sky', 'Clouds', 'Rain', 'Wind'],
  Erosion: ['Erosion'],
  Ecosystem: 'top',
  Flowers: ['Flowers'],
};

// Bring something in the main GUI into view and flash it, so the eye lands on it.
function reveal(els: HTMLElement[]) {
  els[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  for (const el of els) {
    el.animate([{ background: 'rgba(44, 201, 255, 0.6)' }, { background: 'rgba(44, 201, 255, 0)' }], { duration: 1400 });
  }
}

function openUpTo(gui: GUI | undefined) {
  for (let g = gui; g; g = g.parent) g.open();
}

function revealController(c: Controller | undefined) {
  if (!c) return;
  openUpTo(c.parent);
  reveal([c.domElement]);
}

function revealStage(node: Node, root: GUI) {
  const where = CONTROLS[node];
  if (where === 'top') {
    root.open();
    reveal([root.$title]);
    return;
  }
  const folders = root.foldersRecursive().filter((f) => where.includes(f._title));
  folders.forEach((f) => openUpTo(f));
  reveal(folders.map((f) => f.$title));
}

export function addStagesPanel(stages: Stages, root: GUI) {
  const panel = new GUI({ title: 'Stages', width: 270 });
  Object.assign(panel.domElement.style, {
    left: '0',
    right: 'auto',
    top: '52px', // under the FPS counter (48 px tall)
    maxHeight: 'calc(100% - 52px)',
    background: 'transparent', // only the cards are solid, so the lines sit in open gaps
  });

  // How to use it, on a solid background of its own since the panel is see-through.
  const hint = document.createElement('div');
  hint.textContent = 'Click a bold name to find its controls on the right. Click a line to connect or disconnect it.';
  hint.style.cssText =
    'padding:6px 8px;margin-bottom:8px;border-radius:0 0 4px 4px;line-height:1.45;' +
    'background:var(--background-color);color:var(--text-color);';
  panel.$children.appendChild(hint);

  const refreshers: (() => void)[] = [];
  const refresh = () => refreshers.forEach((f) => f());
  stages.onChange = refresh;

  NODES.forEach((node, i) => {
    const card = panel.addFolder(node);
    card.domElement.style.background = 'var(--background-color)';
    card.domElement.style.borderRadius = '4px';
    // Stage names are the top level; make them read as headers.
    Object.assign(card.$title.style, {
      fontSize: '12px',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      borderLeft: '3px solid var(--number-color)',
      background: 'var(--widget-color)',
    });
    // The cards stay open: a click on the name finds the stage on the right instead.
    card.$title.title = 'click to find this stage on the right';
    // Capturing, so this runs before lil-gui's own click handler and can stop it collapsing the card.
    card.$title.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      revealStage(node, root);
    }, { capture: true });
    if (node === 'Season') addSeason(card, stages);
    for (const input of stages.inputs.filter((x) => x.node === node)) {
      refreshers.push(addInput(card, input, root, refresh));
    }
    if (i + 1 < NODES.length) refreshers.push(addConnector(panel, stages, node, NODES[i + 1], refresh));
  });
  refresh();
}

function addSeason(card: GUI, stages: Stages) {
  const s = stages.season;
  card.add(s, 'value', 0, 1).name('season').listen().onChange((v: number) => stages.setSeason(v));
  card.add(s, 'play');
  card.add(s, 'yearSeconds', 5, 120).name('year length (s)');
}

// The rows under an input's own row: indented and dimmer, so they read as its details.
function asDetail(c: Controller) {
  c.domElement.style.paddingLeft = '16px';
  c.$name.style.opacity = '0.7';
  return c;
}

// One input: a row to pick where it comes from, and for numbers, under it, the two ends
// of the mapping while connected. The value itself is not repeated here: disconnected, it
// is set with the stage's own slider on the right, which a click on the name finds.
// Returns a function that brings the rows up to date.
function addInput(card: GUI, input: Input, root: GUI, changed: () => void) {
  const onName = input.mapping?.source.name ?? input.from;
  const choice = { source: onName };
  const dropdown = card.add(choice, 'source', [onName, input.fallback]).name(input.label).onChange((v: string) => {
    input.set(v === onName);
    changed();
    // Now it is set by hand, so show where.
    if (v !== onName) revealController(own);
  });
  // Set apart from the input above, with a stronger name: the second level.
  dropdown.domElement.style.marginTop = '6px';
  dropdown.$name.style.fontWeight = '700';

  // The stage's own control for this in the main GUI, e.g. `cover` in the Clouds folder.
  // For a number, while connected it only shows what the mapping gives.
  const m = input.mapping;
  const at = m ? { object: m.target as object, property: m.key } : input.mirror;
  const own = at && root.controllersRecursive().find((c) => c.object === at.object && c.property === at.property);
  own?.listen();
  if (own) {
    dropdown.$name.style.cursor = 'pointer';
    dropdown.$name.title = 'click to find this on the right';
    dropdown.$name.addEventListener('click', () => revealController(own));
  }

  const ends: Controller[] = []; // shown while connected
  if (m) {
    const [lo, hi] = m.range;
    if (!m.plain) {
      ends.push(
        asDetail(card.add(m, 'at0', lo, hi).name(`at ${m.source.ends[0]}`)),
        asDetail(card.add(m, 'at1', lo, hi).name(`at ${m.source.ends[1]}`)),
      );
    }
  }

  return () => {
    const on = input.isOn();
    choice.source = on ? onName : input.fallback;
    dropdown.updateDisplay();
    if (m) own?.enable(!on);
    ends.forEach((c) => c.show(on));
  };
}

// The line in the gap between two cards, with a label for what it carries. Solid with an
// arrowhead while everything is connected, dotted while only some of it is, dashed and
// faint while none is. Click to cut or restore all of it at once. Returns a function that
// redraws it.
function addConnector(panel: GUI, stages: Stages, from: Node, to: Node, changed: () => void) {
  const carried = stages.inputs.filter((x) => x.node === to && x.from === from);
  const el = document.createElement('div');
  const line = document.createElement('span');
  const head = document.createElement('span');
  const label = document.createElement('span');
  el.append(line, head, label);
  el.style.cssText = 'position:relative;height:36px;cursor:pointer;user-select:none;';
  el.title = 'click to connect or disconnect';
  // A pill, so the text stays readable over the scene behind the gap.
  label.style.cssText =
    'position:absolute;left:48px;top:50%;transform:translateY(-50%);padding:2px 9px;border-radius:10px;' +
    'background:var(--background-color);color:var(--text-color);white-space:nowrap;';
  panel.$children.appendChild(el);

  el.onclick = () => {
    const allOn = carried.every((x) => x.isOn());
    carried.forEach((x) => x.set(!allOn));
    changed();
  };
  return () => {
    const on = carried.filter((x) => x.isOn()).length;
    const style = on === carried.length ? 'solid' : on ? 'dotted' : 'dashed';
    const fade = on ? 1 : 0.5;
    line.style.cssText = `position:absolute;left:26px;top:0;bottom:${on ? 7 : 0}px;border-left:4px ${style} var(--number-color);opacity:${fade};`;
    // Arrowhead into the card below; gone when nothing flows.
    head.style.cssText =
      `position:absolute;left:21px;bottom:0;border-left:7px solid transparent;border-right:7px solid transparent;` +
      `border-top:8px solid var(--number-color);display:${on ? 'block' : 'none'};`;

    label.replaceChildren();
    carried.forEach((x, i) => {
      if (i) label.append(', ');
      const name = document.createElement('span');
      name.textContent = x.label;
      if (!x.isOn()) name.style.cssText = 'text-decoration:line-through;opacity:0.55;';
      label.append(name);
    });
    // With a single thing on the line there is room to say what replaces it.
    if (carried.length === 1 && !on) label.append(` → ${carried[0].fallback}`);
  };
}
