import React from 'react';
import { getClassDisplayName } from '../data/classPassives';
import { COMBAT_ART_FALLBACKS, applyCombatArtFallback, resolveAllyPortrait, resolvePlayerPortrait } from '../data/combatAssets';
import { getPlayerCombatStats, getPlayerPassiveSources } from '../utils/playerCombatDetails';
import EffectReferenceText, { effectTextToParts } from './EffectReferenceText';
import CombatStatsGrid from './CombatStatsGrid';
import './EnemyDetailCard.css';
import { AbilityDescription } from './EnemyDetailCard';
import CompactStatusList from './CompactStatusList';

const PlayerCombatDetailsCard = ({ player, sourcePlayer, summon = false, onClose }) => {
  const portrait = summon ? resolveAllyPortrait(player) : resolvePlayerPortrait(player);
  const statuses = (player?.effects || []).filter(Boolean);
  const passiveSources = summon ? [] : getPlayerPassiveSources(player, sourcePlayer);
  const classFeature = passiveSources.find(source => source.kind === 'classFeature');
  const equippedPassives = passiveSources.filter(source => source.kind === 'equippedPassive');
  const externalPassives = passiveSources.filter(source => !['classFeature', 'equippedPassive'].includes(source.kind));
  const summonArtRole = player?.entityRole === 'trap' || player?.summonRole === 'trap' || player?.temporarySummon ? 'square' : 'summon';
  const renderSources = sources => sources.map(source => <article className="player-combat-passive" key={source.key}><h4>{source.label}</h4>
    {source.descriptionParts?.length ? <EffectReferenceText parts={source.descriptionParts} /> : null}
    {(source.descriptions || []).map((description, index) => <EffectReferenceText parts={effectTextToParts(description)} key={index} />)}
    {source.stateText ? <small className="player-combat-passive__state">{source.stateText}</small> : null}
  </article>);
  return <section className="enemy-detail-card player-combat-detail-card" role="dialog" aria-modal="true" aria-labelledby="player-combat-detail-title">
    <button type="button" className="enemy-detail-close" aria-label="Закрыть сведения о герое" onClick={onClose}>×</button>
    <header className="enemy-detail-header">
      <div className={`enemy-detail-portrait${summon ? ` is-${summonArtRole}` : ''}`} data-art-role={summon ? summonArtRole : 'portrait'}>{portrait ? <img src={portrait} alt={`Портрет: ${player?.name || 'Герой'}`} onError={event => applyCombatArtFallback(event, summon ? COMBAT_ART_FALLBACKS.ally : COMBAT_ART_FALLBACKS.player)} /> : null}</div>
      <div className="enemy-detail-identity"><span className="enemy-detail-category">{summon ? 'Призванный союзник' : getClassDisplayName(player?.class)}</span><h2 id="player-combat-detail-title">{player?.name || 'Герой'}</h2><span className="enemy-detail-location">HP {player?.hp ?? 0} / {player?.maxHp ?? 0}</span></div>
    </header>

    <CombatStatsGrid stats={getPlayerCombatStats(player)} ariaLabel="Текущие боевые характеристики" />

    {statuses.length ? <section className="enemy-detail-section player-combat-status-section" aria-label="Активные эффекты"><h3>Активные эффекты</h3><CompactStatusList effects={statuses} /></section> : null}

    {classFeature ? <section className="enemy-detail-section player-combat-passives" aria-label="Особенность класса"><h3>Особенность класса</h3>{renderSources([classFeature])}</section> : null}
    {equippedPassives.length ? <section className="enemy-detail-section player-combat-passives" aria-label="Пассивные способности"><h3>Пассивные способности</h3>{renderSources(equippedPassives)}</section> : null}
    {externalPassives.length ? <section className="enemy-detail-section player-combat-passives" aria-label="Прочие пассивные эффекты"><h3>Прочие пассивные эффекты</h3>{renderSources(externalPassives)}</section> : null}
    {summon ? <>
      <section className="enemy-detail-section"><h3>Активные способности</h3>{(player.abilities || []).filter(ability => !ability.passive).map(ability => <article className="enemy-detail-ability" key={ability.name}><AbilityDescription ability={ability} compact showHeader /></article>)}</section>
      {(player.abilities || []).some(ability => ability.passive) ? <section className="enemy-detail-section"><h3>Пассивные способности</h3>{(player.abilities || []).filter(ability => ability.passive).map(ability => <article className="enemy-detail-ability is-passive" key={ability.name}><AbilityDescription ability={ability} compact showHeader /></article>)}</section> : null}
    </> : null}
  </section>;
};

export default PlayerCombatDetailsCard;
