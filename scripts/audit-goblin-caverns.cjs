require('./register-expedition.cjs');
const fs = require('fs');
const path = require('path');
const { createExpeditionMapRun } = require('../src/utils/expeditionMapRun');
const { createSeededSimulationRng } = require('../src/utils/simulationRng');
const { auditMapGeometry, mapAdjacency } = require('../src/utils/expeditionGeometryAudit');
const { GOBLIN_CAVERNS_ID } = require('../src/utils/goblinCaverns');
const out = path.resolve(__dirname, '../docs/goblin-caverns');
fs.mkdirSync(out, { recursive: true });
const make = (id, seed) => createExpeditionMapRun({ locationId: 'Гоблинские Норы', templateId: id, rng: createSeededSimulationRng(seed) });
const summaries = [];
for (const id of ['wide-cavern-01', 'goblin-02', 'goblin-03', 'goblin-04', GOBLIN_CAVERNS_ID]) {
  const sample = auditMapGeometry(make(id, 42).mainLayout);
  const aggregate = { rewards: 0, guarded: 0, minRouteFraction: 1, minRouteRewards: Infinity, maxRouteRewards: 0, minRouteEvents: Infinity, maxRouteEvents: 0, byType: {} };
  for (let seed = 0; seed < 100; seed++) {
    const result = auditMapGeometry(make(id, seed).mainLayout);
    if (!result.ok) throw new Error(id + ': ' + result.errors.join('; '));
    for (const route of result.routes) {
      aggregate.rewards += route.rewards; aggregate.guarded += route.guarded;
      aggregate.minRouteRewards = Math.min(aggregate.minRouteRewards, route.rewards);
      aggregate.maxRouteRewards = Math.max(aggregate.maxRouteRewards, route.rewards);
      aggregate.minRouteEvents = Math.min(aggregate.minRouteEvents, route.events);
      aggregate.maxRouteEvents = Math.max(aggregate.maxRouteEvents, route.events);
      if (route.guardedFraction !== null) aggregate.minRouteFraction = Math.min(aggregate.minRouteFraction, route.guardedFraction);
    }
    for (const region of result.regions) {
      const weight = ['approach', 'depth', 'boss'].includes(region.name) ? 3 : 1;
      for (const [type, counts] of Object.entries(region.byType)) {
        const previous = aggregate.byType[type] ||= { total: 0, guarded: 0 };
        previous.total += counts.total * weight; previous.guarded += counts.guarded * weight;
      }
    }
  }
  const nonBoss = sample.regions.slice(0, 5);
  summaries.push({ id, geometry: sample, seeds: [0, 99], routeSamples: 300,
    broadFraction: nonBoss.reduce((n, r) => n + r.broadCells, 0) / (sample.walkable - 1),
    maxThinComponent: Math.max(...nonBoss.map(r => r.longestThinComponent)),
    cuts: nonBoss.reduce((n, r) => n + r.articulationPoints, 0),
    deadEnds: nonBoss.reduce((n, r) => n + r.deadEnds, 0),
    ...aggregate, guardedFraction: aggregate.guarded / aggregate.rewards,
  });
  console.log(id, sample.walkable, sample.blocked, (100 * aggregate.guarded / aggregate.rewards).toFixed(1) + '% protected');
}
const run = make(GOBLIN_CAVERNS_ID, 42);
fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify({ baselineCommit: '86587f919eae55bfe967bf252fb55dc7bdc50c5e', sampleSeed: 42, summaries }, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'sample-layout.json'), JSON.stringify(run, null, 2) + '\n');
const labels = { approach: 'ПОДСТУПЫ', depth: 'ГЛУБИНА', boss: 'БОСС' };
const colors = ['#94c8b5', '#d9bc86', '#a9bce8', '#cfa7ca', '#85bfce', '#f1a19a'];
const layout = run.mainLayout;
const slots = Object.keys(layout.sublocationEntranceCellIds);
const byId = new Map(layout.cells.map(c => [c.id, c]));
const group = c => c.region === 'approach' ? 0 : c.region === 'depth' ? 4 : c.region === 'boss' ? 5 : slots.indexOf(c.sublocationId) + 1;
const xs = layout.cells.map(c => (c.q + c.r / 2) * 32), ys = layout.cells.map(c => c.r * 28);
const minX = Math.min(...xs) - 45, minY = Math.min(...ys) - 40;
const width = Math.max(...xs) - minX + 45, height = Math.max(...ys) - minY + 170;
const pos = c => [(c.q + c.r / 2) * 32 - minX, c.r * 28 - minY + 90];
const polygon = (x, y) => Array.from({ length: 6 }, (_, i) => {
  const angle = (30 + i * 60) * Math.PI / 180;
  return `${(x + 18.35 * Math.cos(angle)).toFixed(2)},${(y + 18.35 * Math.sin(angle)).toFixed(2)}`;
}).join(' ');
const escape = s => String(s).replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const adjacency = mapAdjacency(layout);
function route(start, target, allowed) {
  const queue = [[start]], seen = new Set([start]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i], tail = current[current.length - 1];
    if (tail === target) return current;
    for (const id of adjacency.get(tail) || []) if (allowed.has(id) && !seen.has(id)) { seen.add(id); queue.push([...current, id]); }
  }
  throw Error('Missing diagram route');
}
const guidePaths = [];
slots.forEach(id => {
  guidePaths.push(route(layout.startCellId, layout.sublocationEntranceCellIds[id], new Set(layout.cells.filter(c => c.region === 'approach' || c.id === layout.sublocationEntranceCellIds[id]).map(c => c.id))));
  guidePaths.push(route(layout.sublocationEntranceCellIds[id], layout.sublocationExitCellIds[id], new Set(layout.cells.filter(c => c.sublocationId === id).map(c => c.id))));
  guidePaths.push(route(layout.depthEntryCellIds[id], layout.bossCellId, new Set(layout.cells.filter(c => ['depth', 'boss'].includes(c.region)).map(c => c.id))));
});
const symbols = { COMBAT: '†', CURSED_ENEMY: 'X', RESOURCE: 'R', TREASURE: 'T', SECRET: '?', FISHING: '≈', CURSE_ALTAR: 'A', BOSS: 'B' };
function svg(content) {
  const title = content ? 'B · ИГРОВОЙ КОНТЕНТ · SEED 42' : 'A · ГЕОМЕТРИЯ И МАРШРУТЫ';
  const result = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}"><rect width="100%" height="100%" fill="#17202c"/><g font-family="Arial,sans-serif" fill="#edf3fb"><text x="24" y="30" font-size="22" font-weight="bold">${title}</text><text x="24" y="55" font-size="13">Гоблинские Норы · 598 проходимых / 549 непроходимых гексов · выбирается одна из трёх подлокаций</text>`];
  for (const c of layout.cells) {
    const [x, y] = pos(c), terrain = c.walkable === false;
    const fill = terrain ? '#3b4553' : colors[group(c)];
    const tooltip = `${c.id} · (${c.q}, ${c.r}) · ${terrain ? 'непроходимо' : (c.previewRoomType || c.landmark?.type || 'проход')}${c.guardedBy ? ' · охрана: ' + c.guardedBy : ''}`;
    result.push(`<polygon points="${polygon(x, y)}" fill="${fill}" stroke="${content && c.guardedBy ? '#11e8e0' : '#17202c'}" stroke-width="${content && c.guardedBy ? 3 : 1}"><title>${escape(tooltip)}</title></polygon>`);
  }
  if (!content) for (const pathIds of guidePaths) result.push(`<polyline points="${pathIds.map(id => pos(byId.get(id)).join(',')).join(' ')}" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="5 5" opacity="0.85"/>`);
  const guardIds = new Set(layout.cells.filter(c => c.guardedBy).map(c => c.guardedBy));
  for (const c of layout.cells.filter(c => c.walkable !== false)) {
    const [x, y] = pos(c);
    let symbol = content ? symbols[c.previewRoomType] || '' : '';
    if (c.id === layout.startCellId) symbol = 'S';
    if (c.landmark?.type === 'sublocation-entrance') symbol = String(slots.indexOf(c.sublocationId) + 1);
    if (c.landmark?.type === 'sublocation-exit') symbol = '↑';
    if (c.landmark?.type === 'depth-entrance') symbol = 'D';
    if (c.landmark?.type === 'depth-completion' && !content) symbol = 'C';
    if (c.landmark?.type === 'boss') symbol = 'B';
    if (content && guardIds.has(c.id)) result.push(`<circle cx="${x}" cy="${y}" r="13" fill="#a32339"/>`);
    if (symbol) result.push(`<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="15" font-weight="bold" fill="${content && guardIds.has(c.id) ? '#fff' : '#17202c'}">${symbol}</text>`);
  }
  const legends = content
    ? ['† бой · X проклятый · R ресурсы · T сокровища · ? случайное событие · ≈ рыбалка · A алтарь', 'Красный круг: охрана. Бирюзовая рамка: награда за этой охраной. Ключи выпадают в боях по обычным правилам.']
    : ['S старт · 1/2/3 входы подлокаций · ↑ выходы · D входы Глубины · C бой перед боссом · B босс', 'Серый: непроходимый резерв. Пунктир: пример основных путей, без учёта ещё не пройденных событий.'];
  legends.forEach((text, i) => result.push(`<text x="24" y="${height - 48 + i * 22}" font-size="13">${text}</text>`));
  return result.join('') + '</g></svg>';
}
fs.writeFileSync(path.join(out, 'geometry.svg'), svg(false));
fs.writeFileSync(path.join(out, 'content.svg'), svg(true));
const pct = n => (n * 100).toFixed(1) + '%';
const rows = summaries.map(s => `| ${s.id} | ${s.geometry.walkable} | ${s.geometry.blocked} | ${pct(s.broadFraction)} | ${s.maxThinComponent} | ${s.deadEnds} | ${s.cuts} | ${pct(s.guardedFraction)} | ${pct(s.minRouteFraction)} |`).join('\n');
const current = summaries[summaries.length - 1];
const types = Object.entries(current.byType).map(([name, c]) => `| ${name} | ${(c.total / 300).toFixed(2)} | ${(c.guarded / 300).toFixed(2)} | ${c.total ? pct(c.guarded / c.total) : '—'} | ${['RESOURCE','TREASURE'].includes(name) ? 'Да' : 'Нет'} |`).join('\n');
fs.writeFileSync(path.join(out, 'README.md'), `# Гоблинские Норы: плотность содержимого

Вариант goblin-caverns-02 сохраняет геометрию: 598 проходимых клеток во всём шаблоне, **454 в одном доступном походе**. Две из трёх подлокаций закрываются после выбора. Другие шаблоны и существующие сохранённые карты не пересоздаются. Новое наполнение применяется к новым походам этого варианта.

Предыдущая версия сохраняла слишком маленький бюджет: 47–54 события и минимум 12 прямых наград на доступный маршрут. Revision 2 увеличивает количество контента, не уменьшая карту.

| Область | Минимум событий | Минимум прямых наград | Минимум боёв | Минимум рыбалок |
|---|---:|---:|---:|---:|
| Подход | 64 | 18 | 18 | 2 |
| Одна выбранная подлокация | 28 | 10 | 8 | 1 |
| Глубина | 64 | 18 | 18 | 2 |
| Босс | 1 | — | 1 | — |
| Доступный маршрут | 157 | 46 | 45 | 5 |

Сохраняется исходная лотерея событий; добавляются бои, ресурсы, сокровища, рыбалки и SECRET (случайные события с существующими исходами). Дополнения отмечены supplementalContent; прямые награды также supplementalReward. Базовые события не заменяются. Во всех областях от любой клетки до ближайшего события не больше двух физических шагов; проверяется графом, а не расстоянием по прямой. Генератор распределяет события и в залах, и в оставшемся пространстве наградных камер.

На seed 0–99 и всех трёх выборах подлокации (300 маршрутов): **${current.minRouteEvents}–${current.maxRouteEvents} событий**, **${current.minRouteRewards}–${current.maxRouteRewards} прямых наград**, среднее **${(current.rewards / 300).toFixed(2)}** награды. Это полный доступный маршрут, а не сумма трёх альтернатив. Инвентарь не обязан вместить всё; события можно обходить и уходить раньше. Награды боёв, случайные исходы SECRET и мини-игры FISHING в прямой наградной бюджет не включены.

## Охрана и геометрия

Минимум 70% прямых наград каждой области находятся за физической охраной. Проверка удаляет клетку охранника из графа даже при открытых трёх ветвях. Геометрия, ключи и семь переходов между областями сохранены. Сильные противники в Подходе по-прежнему запрещены независимо от числа боёв.

| Шаблон | Проходимые | Непроходимые | Клетки с ≥3 соседями | Макс. узкая цепочка | Тупики | Точки сочленения | Охрана в среднем | Минимум на маршрут |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${rows}

| Тип | Среднее на доступный маршрут | За боями | Доля охраны | Прямая награда |
|---|---:|---:|---:|---|
${types}

## Воспроизведение

- npm run audit:goblin-map — пересоздать отчёт, схемы и метрики.
- npm run test:expedition-maps — карты, ключи, старые сохранения, маршруты.
- MAP_AUDIT_SEEDS=1000 npm run test:goblin-map — расширенный прогон бюджетов.
- [Геометрия](geometry.svg), [события seed 42](content.svg), [сравнение A/B](review.html), [метрики](metrics.json), [сохранение примера](sample-layout.json).

Графовые проверки не заменяют оценку темпа реальной игры. Экономика одного полного исследования стала щедрее вместе с количеством событий; награды отдельных событий и характеристики врагов не менялись.
`);
const svgA=svg(false),svgB=svg(true);
fs.writeFileSync(path.join(out, 'review.html'), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Гоблинские Норы — технические схемы</title><style>body{margin:0;background:#101722;color:#edf3fb;font:15px Arial}header{position:sticky;top:0;background:#101722;padding:14px;z-index:2;border-bottom:1px solid #445}button{min-height:44px;padding:8px 18px;margin-right:6px;cursor:pointer}main{overflow:auto}section{min-width:800px}svg{display:block;width:100%}a{color:#8ee7ef}.off{display:none}p{margin:10px 0}</style><header><strong>Blighted Abyss · один вариант Гоблинских Нор</strong><p>Точная схема из игровых координат. Все три слота показаны для проверки; в забеге выбирается один.</p><button id="a">A — Геометрия</button><button id="b">B — Контент, seed 42</button><a href="README.md">Метрики и отчёт</a></header><main><section id="geo">${svgA}</section><section id="events" class="off">${svgB}</section></main><script>const geo=document.querySelector('#geo'),events=document.querySelector('#events');document.querySelector('#a').onclick=()=>{geo.classList.remove('off');events.classList.add('off')};document.querySelector('#b').onclick=()=>{geo.classList.add('off');events.classList.remove('off')};</script></html>`);
