import React, { useState } from "react";
import {
  COMBAT_ART_FALLBACKS,
  applyCombatArtFallback,
  resolveAbilityIcon,
  resolveEnemyPortrait,
} from "../data/combatAssets";
import EffectReferenceText, { effectTextToParts } from "./EffectReferenceText";
import { CONTROL_EFFECT_IDS, getEffectDefinition } from '../utils/effects';
import CombatStatsGrid from "./CombatStatsGrid";
import { getCombatantSecondaryStats } from "../utils/playerCombatDetails";
import "./EnemyDetailCard.css";
import CompactStatusList from './CompactStatusList';

const categoryLabel = enemy => {
  if (enemy?.isBoss || enemy?.boss || enemy?.type === "boss") return "Босс";
  if (enemy?.isMiniBoss || enemy?.miniBoss || enemy?.type === "miniboss") return "Мини-босс";
  if (enemy?.isSummon || enemy?.summoned || enemy?.type === "summon") return "Призванный";
  if (enemy?.isElite || enemy?.elite || enemy?.type === "elite" || enemy?.encounterPhase === "elite") return "Элитный";
  if (enemy?.isStrong || enemy?.strong || enemy?.type === "strong" || enemy?.encounterPhase === "late") return "Сильный";
  return "Обычный";
};

const formatValue = value => value === undefined || value === null ? "—" : value;

const abilityTypeLabel = type => ({
  physical: "Физический",
  magical: "Магический",
  support: "Поддержка",
}[type] || type);

export const AbilityDescription = ({ ability, compact = false, showHeader = false }) => {
  const parts = Array.isArray(ability.descriptionParts)
    ? ability.descriptionParts
    : effectTextToParts(ability.description || "Описание способности пока недоступно.");
  const icon = resolveAbilityIcon(ability);
  return <div className={`enemy-detail-ability-description${compact ? " is-compact" : ""}`}>
    {showHeader ? <header className="enemy-detail-ability-header">{icon ? <img src={icon} alt="" aria-hidden="true" onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.ability)} /> : null}<strong>{ability.name}</strong></header> : null}
    <EffectReferenceText parts={parts} />
  </div>;
};

const AbilityTile = ({ ability, passive, expanded, onToggle }) => {
  const icon = resolveAbilityIcon(ability);
  const descriptionId = `enemy-ability-${ability.name}-${passive ? "passive" : "active"}`;
  const type = ability.type || ability.school || ability.damageType;
  return (
    <article className={`enemy-detail-ability${passive ? " is-passive" : ""}`}>
      <button
        type="button"
        className="enemy-detail-ability-toggle"
        aria-expanded={expanded}
        aria-controls={descriptionId}
        onClick={onToggle}
      >
        <span className="enemy-detail-ability-art" aria-hidden="true">
          {icon ? (
            <img
              src={icon}
              alt=""
              onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.ability)}
            />
          ) : <span className="enemy-detail-ability-fallback">✦</span>}
        </span>
        <span className="enemy-detail-ability-copy">
          <strong>{ability.name || "Способность"}</strong>
          <span className="enemy-detail-ability-meta">
            {passive ? <span>Пассивно</span> : null}
            {!passive && ability.cooldown > 0 ? (
              <span>КД {ability.currentCooldown > 0 ? `${ability.currentCooldown}/` : ""}{ability.cooldown}</span>
            ) : null}
            {!passive && type ? <span>{abilityTypeLabel(type)}</span> : null}
          </span>
        </span>
        <span className="enemy-detail-chevron" aria-hidden="true">⌄</span>
      </button>
      {expanded ? (
        <div id={descriptionId}><AbilityDescription ability={ability} /></div>
      ) : null}
    </article>
  );
};

const AbilitySection = ({ title, abilities, passive, expandedKey, onToggle }) => {
  if (!abilities.length) return null;
  return (
    <section className="enemy-detail-section" aria-labelledby={`enemy-detail-${passive ? "passives" : "actives"}`}>
      <h3 id={`enemy-detail-${passive ? "passives" : "actives"}`}>{title}</h3>
      <div className="enemy-detail-ability-list">
        {abilities.map((ability, index) => {
          const key = `${passive ? "passive" : "active"}-${ability.name || index}`;
          return (
            <AbilityTile
              key={key}
              ability={ability}
              passive={passive}
              expanded={expandedKey === key}
              onToggle={() => onToggle(expandedKey === key ? null : key)}
            />
          );
        })}
      </div>
    </section>
  );
};

export default function EnemyDetailCard({ enemy, onClose }) {
  const [expandedKey, setExpandedKey] = useState(null);
  if (!enemy) {
    return (
      <section className="enemy-detail-card" role="dialog" aria-modal="true" aria-label="Враг недоступен">
        <div className="enemy-detail-empty">Этот противник больше не найден в текущем состоянии боя.</div>
        <button type="button" className="enemy-detail-close" onClick={onClose}>Закрыть</button>
      </section>
    );
  }

  const signatureAbilities = (enemy.abilities || []).filter(ability => !ability?.basic && ability?.name !== "Атака");
  const activeAbilities = signatureAbilities.filter(ability => !ability?.passive);
  const passiveAbilities = signatureAbilities.filter(ability => ability?.passive);
  const portrait = resolveEnemyPortrait(enemy);
  const secondary = getCombatantSecondaryStats(enemy);
  const stats = [
    { key: "hp", label: "Здоровье", value: `${formatValue(enemy.hp)} / ${formatValue(enemy.maxHp)}` },
    { key: "shield", label: "Щит", value: formatValue(enemy.shield || 0) },
    { key: "attack", label: "Атака", value: enemy.attack },
    { key: "magAtk", label: "Маг. атака", value: enemy.magAtk },
    { key: "physDef", label: "Физ. защ.", value: enemy.physDef },
    { key: "magicDef", label: "Маг. защ.", value: enemy.magicDef },
    { key: "speed", label: "Скорость", value: enemy.speed },
    { key: "dodge", label: "Уворот", value: secondary.dodge },
    { key: "critChance", label: "Крит. шанс", value: secondary.critChance },
    { key: "critDamage", label: "Крит. урон", value: secondary.critDamage },
  ].filter(stat => stat.value !== undefined && stat.value !== null);
  const statuses = (enemy.effects || []).filter(Boolean);
  const preparation = enemy._preparation?.durability > 0 ? enemy._preparation : null;
  const controlNames = [...CONTROL_EFFECT_IDS].map(id => getEffectDefinition(id)?.name).filter(Boolean).join(', ');

  return (
    <section className="enemy-detail-card" role="dialog" aria-modal="true" aria-labelledby="enemy-detail-title">
      <button type="button" className="enemy-detail-close" aria-label="Закрыть сведения о враге" onClick={onClose}>×</button>
      <header className="enemy-detail-header">
        <div className="enemy-detail-portrait">
          {portrait ? (
            <img
              src={portrait}
              alt={`Портрет: ${enemy.name || "Враг"}`}
              onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.enemy)}
            />
          ) : null}
        </div>
        <div className="enemy-detail-identity">
          <span className="enemy-detail-category">{categoryLabel(enemy)}</span>
          <h2 id="enemy-detail-title">{enemy.name || "Враг"}</h2>
          {(enemy.expeditionModifiers || [])
            .filter(modifier => modifier?.id !== 'abyss-power')
            .map(modifier => modifier?.label
              ? <span key={modifier.id || modifier.label} className="enemy-detail-location">{modifier.label}</span>
              : null)}
          {enemy.location ? <span className="enemy-detail-location">{enemy.location}</span> : null}
        </div>
      </header>

      <CombatStatsGrid stats={stats} ariaLabel="Боевые характеристики" />

      {statuses.length ? (
        <section className="enemy-detail-statuses" aria-label="Текущие эффекты">
          <CompactStatusList effects={statuses} />
        </section>
      ) : null}

      {(enemy.innateControlImmune || preparation) ? <section className="enemy-detail-traits" aria-label="Постоянные свойства">
        <h3>Свойства</h3>
        {enemy.innateControlImmune ? <div className="enemy-detail-trait"><strong>Иммунитет к контролю</strong><span>Предотвращает эффекты: {controlNames}.</span></div> : null}
        {preparation ? <div className="enemy-detail-trait"><strong>Подготовка</strong><span>{preparation.resolveName || 'Подготовленное действие'} · прочность {preparation.durability} / {preparation.maxDurability}</span></div> : null}
      </section> : null}

      <AbilitySection title="Активные способности" abilities={activeAbilities} passive={false} expandedKey={expandedKey} onToggle={setExpandedKey} />
      <AbilitySection title="Пассивные способности" abilities={passiveAbilities} passive expandedKey={expandedKey} onToggle={setExpandedKey} />
    </section>
  );
}
