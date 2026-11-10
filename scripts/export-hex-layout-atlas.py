"""Render the fixed map catalog for review. No generated images belong in git.
Usage: python scripts/export-hex-layout-atlas.py /tmp/ashen-hex-layouts.html
Only Python's standard library is required.
"""
import json
import sys
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COLORS = ['#c4d0dc', '#6fbb95', '#d6ab63', '#ac88cc', '#648fb3', '#e87967']


def render(template):
    regions = [template['approach'], *template['sublocations'], template['depth'], template['boss']]
    points = [(q, int(r), i) for i, region in enumerate(regions) for r, qs in region['rows'].items() for q in qs]
    def project(q, r): return ((q + r * .5) * 74, r * 41)
    xy = [project(q, r) for q, r, _ in points]
    x0 = min(x for x, y in xy) - 65; y0 = min(y for x, y in xy) - 55
    width = max(x for x, y in xy) - x0 + 65; height = max(y for x, y in xy) - y0 + 55
    clip = [(.50,.00),(.94,.24),(.94,.76),(.50,1),(.06,.76),(.06,.24)]
    out = [f'<svg role="img" aria-label="{escape(template["label"])}" viewBox="{x0} {y0} {width} {height}">']
    for q, r, i in points:
        x, y = project(q, r)
        poly = ' '.join(f'{x+(a-.5)*92:.1f},{y+(b-.5)*54:.1f}' for a,b in clip)
        out.append(f'<polygon points="{poly}" fill="{COLORS[i]}" stroke="#16202c" stroke-width="2"><title>{q}, {r}</title></polygon>')
    gates=[]
    for s in template['sublocations']:
        gates += [(s['approachParent'],s['entrance']), (s['exit'],s['depthEntry'])]
    gates.append((template['depth']['completion'],template['boss']['boss']))
    for a,b in gates:
        x,y=project(a['q'],a['r']);u,v=project(b['q'],b['r'])
        out.append(f'<path d="M{x},{y} L{u},{v}" stroke="#fcf5d5" stroke-width="7"/>')
    for point,label in [(template['approach']['start'],'С'),(template['boss']['boss'],'Б')]:
        x,y=project(point['q'],point['r'])
        out.append(f'<circle cx="{x}" cy="{y}" r="19" fill="#111923"/><text x="{x}" y="{y+9}" text-anchor="middle" font-size="26" font-family="sans-serif" fill="white">{label}</text>')
    out.append('</svg>')
    return ''.join(out), len(points)


def main():
    templates = json.loads((ROOT/'src/data/expeditionLocationLayouts.json').read_text())
    cards=[]
    for t in templates:
        svg,n=render(t)
        cards.append(f'<article data-location="{escape(t["locationId"])}"><h2>{escape(t["label"])}</h2><p>{n} гексов · 44 содержательные клетки на выбранном маршруте</p><button class="map" aria-label="Увеличить {escape(t["label"])}">{svg}</button><small>{escape(t["id"])}</small></article>')
    options=''.join(f'<option>{escape(name)}</option>' for name in dict.fromkeys(t['locationId'] for t in templates))
    labels=['Подход','Подлокация 1','Подлокация 2','Подлокация 3','Глубина','Босс']
    legend=''.join(f'<span><i style="background:{c}"></i>{name}</span>' for c,name in zip(COLORS,labels))
    html='''<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ashen Abyss — 20 гекс-карт</title><style>
*{box-sizing:border-box}body{margin:0;background:#111820;color:#edf1f5;font:16px system-ui,sans-serif}header{padding:30px 4vw;background:#1a2531}h1{margin:0;font-size:28px}p{color:#aabac9;line-height:1.6}select{padding:10px;background:#111820;color:inherit;border:1px solid #586778;border-radius:8px;font:inherit}.legend{display:flex;flex-wrap:wrap;gap:16px;margin:18px 0}.legend span{display:flex;align-items:center;gap:7px}i{width:14px;height:14px;border-radius:3px}main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;padding:24px 4vw}article{background:#1a2531;border:1px solid #354457;border-radius:12px;padding:20px}h2{font-size:18px;margin:0}article p,small{font-size:13px;color:#aabac9}button.map{border:0;background:none;width:100%;cursor:zoom-in}svg{width:100%;height:400px}dialog{background:#111820;color:white;border:1px solid #586778;border-radius:10px;width:95vw;height:94vh}dialog svg{height:80vh}dialog::backdrop{background:#000b}.close{position:absolute;right:16px;top:12px;padding:10px;font:inherit;cursor:pointer}@media(max-width:750px){main{grid-template-columns:1fr}svg{height:330px}}[hidden]{display:none!important}</style><header><h1>Ashen Abyss · 20 гекс-карт · ревизия 2</h1><p>Расширенные зоны и обходы вместо длинных узких коридоров. Пять локаций × четыре схемы. Нажми на карту для увеличения. С — старт, Б — босс; светлые перемычки — единственные проходы между зонами.<br>Геометрия фиксирована. Содержимое клеток и три подлокации из четырёх определяются при создании похода.</p><select aria-label="Локация"><option>Все локации</option>'''+options+'</select><div class="legend">'+legend+'</div></header><main>'+''.join(cards)+'''</main><dialog><button class="close">Закрыть</button><div></div></dialog><script>
const select=document.querySelector('select'),dialog=document.querySelector('dialog');select.onchange=()=>document.querySelectorAll('article').forEach(card=>card.hidden=select.selectedIndex>0&&card.dataset.location!==select.value);document.querySelectorAll('.map').forEach(button=>button.onclick=()=>{dialog.querySelector('div').innerHTML=button.innerHTML;dialog.showModal()});document.querySelector('.close').onclick=()=>dialog.close();</script></html>'''
    out=Path(sys.argv[1]);out.write_text(html);print(out, out.stat().st_size)

if __name__=='__main__':main()
