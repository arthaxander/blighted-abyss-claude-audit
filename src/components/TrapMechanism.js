import React, { memo, useId } from 'react';
import { TRAP_SECTORS } from '../minigames/trapConfig';
import rim from '../assets/trap/rim-track.webp';
import plate from '../assets/trap/plate.webp';
import hub from '../assets/trap/hub.webp';
import base from '../assets/trap/latch-base.webp';
import bolt from '../assets/trap/latch-bolt.webp';
import needle from '../assets/trap/needle.webp';
import pressedPlate from '../assets/trap/pressed-plate.webp';
import seam from '../assets/trap/seam.webp';

const point = (angle, radius) => {
  const radians = (angle - 90) * Math.PI / 180;
  return [160 + Math.cos(radians) * radius, 160 + Math.sin(radians) * radius];
};
let edge = 0;
const sectors = TRAP_SECTORS.map(size => {
  const start = edge;
  edge += size;
  const a = point(start, 124);
  const b = point(edge, 124);
  return {
    start,
    end: edge,
    middle: start + size / 2,
    label: point(start + size / 2, 94),
    indicator: point(start + size / 2, 110),
    path: `M160 160 L${a[0]} ${a[1]} A124 124 0 0 1 ${b[0]} ${b[1]} Z`,
  };
});

// The expensive textured plate and latches do not rerender with the needle.
const Plates = memo(({ marked, failedSector, id }) => <>
  <circle cx="160" cy="160" r="125" fill="#494638" />
  {sectors.map((sector, index) => {
    const done = marked.includes(index);
    return <g key={index} className={`trap-disarm__sector${done ? ' is-marked' : ''}${failedSector === index ? ' is-failed' : ''}`} data-testid={`trap-sector-${index}`} data-marked={done}>
      <path d={sector.path} fill={`url(#${id}-${done ? 'pressed' : 'metal'}-${index})`} />
      <path d={sector.path} className="trap-disarm__sector-tint" />
      <g clipPath={`url(#${id}-sector-${index})`}>
        {/* Each half of the joint belongs to its plate and follows its depth. */}
        {[sector.start, sector.end].map(boundary => <g key={boundary} transform={`rotate(${boundary} 160 160)`} className="trap-disarm__joint">
          <svg x="158.3" y="35" width="3.4" height="102" viewBox="460 18 72 1550" preserveAspectRatio="none" overflow="hidden">
            <image href={seam} width="992" height="1586" />
          </svg>
        </g>)}
        <path d={sector.path} className="trap-disarm__bevel" stroke={`url(#${id}-${done ? 'inset' : 'raised'})`} />
        {done && <path d={sector.path} transform="translate(1.1 1.5)" className="trap-disarm__inset-shadow" />}
        {done && <path d={sector.path} className="trap-disarm__edge-glint" />}
      </g>
      <path d={sector.path} className="trap-disarm__seam" />
      <text x={sector.label[0]} y={sector.label[1]}>{index + 1}</text>
      {done && <g transform={`translate(${sector.indicator[0]} ${sector.indicator[1]})`} className="trap-disarm__released-mark" aria-hidden="true">
        <circle r="4" />
        <path d="M-2 0 L-.5 1.5 L2.5 -1.5" />
      </g>}
    </g>;
  })}
  <circle cx="160" cy="160" r="125" className="trap-disarm__rim-fallback" />
  <image href={rim} x="0" y="0" width="320" height="320" />
  {sectors.map((sector, index) => <g key={index} transform={`rotate(${sector.middle} 160 160)`}>
    <rect x="150" y="15" width="20" height="24" rx="3" fill="#080c0b" stroke="#090d0b" strokeWidth="2" />
    <rect x="151" y="16" width="18" height="21" rx="2" fill={`url(#${id}-lock-steel)`} stroke="#777a70" strokeWidth=".7" />
    <rect x="156" y="19" width="8" height="19" rx="1" fill="#080d0c" />
    <svg x="150.5" y="20" width="19" height="8" viewBox="35 400 1185 480" overflow="hidden">
      <image href={base} width="1254" height="1254" />
    </svg>
    <g clipPath={`url(#${id}-lock-travel)`}>
    <g className={`trap-disarm__bolt${marked.includes(index) ? ' is-open' : ''}`}>
      <svg x="153.5" y="23" width="13" height="22" viewBox="160 70 700 1370" overflow="hidden">
        <g clipPath={`url(#${id}-bolt-cutout)`}>
          <image href={bolt} width="1024" height="1536" />
        </g>
      </svg>
    </g>
    </g>
    <path d="M152 21 H168" stroke="#adb09b" strokeWidth="1" />
    <path d="M152 29 H155 M165 29 H168" stroke="#676c61" strokeWidth="2" />
  </g>)}
</>);

export default function TrapMechanism({ angle, marked, failedSector }) {
  const id = useId().replace(/:/g, '');
  return <svg className="trap-disarm__dial" viewBox="0 0 320 320" role="img" aria-label={`Механизм: отмечено ${marked.length} из ${TRAP_SECTORS.length} секторов`}>
    <defs>
      <clipPath id={`${id}-lock-travel`}><rect x="150" y="17" width="20" height="29" /></clipPath>
      <linearGradient id={`${id}-lock-steel`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#515a53" /><stop offset=".3" stopColor="#242e29" /><stop offset="1" stopColor="#121915" />
      </linearGradient>
      {sectors.map((sector, index) => <React.Fragment key={index}>
        <clipPath id={`${id}-sector-${index}`}><path d={sector.path} /></clipPath>
        <pattern id={`${id}-metal-${index}`} patternUnits="userSpaceOnUse" width="320" height="320" patternTransform={`rotate(${index * 31} 160 160)`}>
          <rect width="320" height="320" fill="#494638" />
          <image href={plate} width="320" height="320" />
        </pattern>
        <pattern id={`${id}-pressed-${index}`} patternUnits="userSpaceOnUse" width="320" height="320" patternTransform={`rotate(${index * 31} 160 160)`}>
          <rect width="320" height="320" fill="#282b26" />
          <image href={pressedPlate} width="320" height="320" />
        </pattern>
      </React.Fragment>)}
      <linearGradient id={`${id}-raised`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#e7c890" /><stop offset=".45" stopColor="#77684d" /><stop offset="1" stopColor="#0b100d" />
      </linearGradient>
      <linearGradient id={`${id}-inset`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#080d0b" /><stop offset=".55" stopColor="#1c241c" /><stop offset="1" stopColor="#a79970" />
      </linearGradient>
      {/* Explicit contours exclude the generator's semi-transparent halos. */}
      <clipPath id={`${id}-bolt-cutout`}>
        <path d="M389 80 Q366 82 367 112 L370 295 L387 325 L387 914 L370 935 L267 955 Q210 913 186 955 Q168 1005 190 1060 Q218 1100 270 1061 L370 1065 L379 1390 Q382 1425 412 1425 L620 1425 Q647 1425 647 1390 L647 1110 L665 1080 L757 1065 Q799 1110 836 1065 Q857 1018 836 966 Q809 918 765 950 L663 950 L647 925 L641 325 L656 300 L656 108 Q654 80 628 80 Z" />
      </clipPath>
      <clipPath id={`${id}-needle-cutout`}>
        <path d="M512 36 L480 176 L502 198 L498 1490 Q512 1498 527 1490 L523 198 L541 176 Z" />
      </clipPath>
    </defs>
    <Plates marked={marked} failedSector={failedSector} id={id} />
    <g transform={`rotate(${angle} 160 160)`} className="trap-disarm__needle" data-testid="trap-needle">
      <path d="M160 157 L160 43 M157.5 46 L160 36 L162.5 46 Z" className="trap-disarm__needle-outline" />
      <path d="M160 157 L160 43 M157.5 46 L160 36 L162.5 46 Z" className="trap-disarm__needle-fallback" />
      <svg x="156.5" y="36" width="7" height="126" viewBox="470 30 82 1470" preserveAspectRatio="none">
        <g clipPath={`url(#${id}-needle-cutout)`}><image href={needle} width="1024" height="1536" /></g>
      </svg>
    </g>
    <circle cx="160" cy="160" r="26" fill="#18231e" stroke="#b6a273" />
    <image href={hub} x="132" y="132" width="56" height="56" />
    <text x="160" y="161" className="trap-disarm__count">{marked.length}/{TRAP_SECTORS.length}</text>
  </svg>;
}
