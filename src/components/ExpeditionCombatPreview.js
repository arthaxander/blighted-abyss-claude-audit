import React, { useState } from 'react';
import { findItemData } from '../data/items';
import { getInventoryItemUseCapability } from '../utils/inventoryItemUse';
import { applyCombatArtFallback, COMBAT_ART_FALLBACKS, resolveEnemyPortrait } from '../data/combatAssets';
import { getActiveCursesList, getCurseDefinition } from '../data/curses';
import StatusLinkedText from './StatusLinkedText';
import './ExpeditionCombatPreview.css';

const ROMAN = ['—', 'I', 'II', 'III', 'IV', 'V'];

const getEncounterTitle = room => {
  if (room?.type === 'Босс') return 'Арена босса';
  if (room?.type === 'Проклятый враг') return 'Проклятый противник';
  return 'Боевая встреча';
};

const getEnemyTag = enemy => {
  if (enemy?.boss) return 'БОСС';
  if (enemy?.roomRole === 'cursedEnemy' || enemy?.miniBoss) return 'ПРОКЛЯТЫЙ';
  if (enemy?.rewardRank === 'strong' || enemy?.encounterPhase === 'late') return 'STRONG';
  return null;
};

const ExpeditionCombatPreview = ({
  room,
  player,
  locationEffect = null,
  sublocationDefinition = null,
  onEnter,
  onAutobattleChange,
  onUseFieldItem,
  autobattleUnlocked = false,
  onRetreat,
  onInspectEnemy,
}) => {
  const [prepItemsOpen, setPrepItemsOpen] = useState(false);
  const visibleEnemies = (room?.enemies || []).filter(Boolean);
  const fieldItems = (player?.runInventory || []).flatMap((stack, slotIndex) => {
    if (!stack || !(stack.quantity > 0)) return [];
    const definition = findItemData(stack.itemId || stack.name);
    if (!definition?.fieldUse) return [];
    return [{
      slotIndex, stack, definition,
      capability: getInventoryItemUseCapability(stack, { player, inExpedition: true, inCombat: false }),
    }];
  });
  const curses = getActiveCursesList(player?.curses);
  const modifiers = [
    locationEffect
      ? {
          id: 'location',
          title: locationEffect.name || 'Эффект локации',
          description: locationEffect.description,
          symbol: 'Л',
        }
      : null,
    sublocationDefinition
      ? {
          id: 'sublocation',
          title: sublocationDefinition.name,
          description: sublocationDefinition.effectSummary,
          symbol: 'П',
        }
      : null,
    room?.abyssPower
      ? {
          id: 'abyss-power',
          title: room.abyssPower.label || '[Мощь Бездны]',
          description: room.abyssPower.description || 'Глубина усиливает эту боевую встречу.',
          symbol: 'Б',
        }
      : null,
  ].filter(Boolean);

  return (
    <section className="expedition-combat-preview" aria-labelledby="expedition-combat-preview-title">
      <div className="expedition-combat-preview__scroll">
        <div className="expedition-combat-preview__content">
          <header className="expedition-combat-preview__header">
            <div>
              <small>ПРЕДПРОСМОТР БОЯ</small>
              <h2 id="expedition-combat-preview-title">{getEncounterTitle(room)}</h2>
            </div>
            <span>{player?.currentLocation || 'Бездна'}</span>
          </header>

          <section className="expedition-combat-preview__block">
            <h3>Противники</h3>
            <div className="expedition-combat-preview__roster" aria-label="Противники">
              {visibleEnemies.map((enemy, index) => {
                const portrait = resolveEnemyPortrait(enemy);
                const tag = getEnemyTag(enemy);
                const identity = enemy.id || enemy.portraitKey || enemy.portraitId || enemy.name || 'enemy';
                return (
                  <button
                    type="button"
                    className="expedition-combat-preview__enemy"
                    key={`${identity}-${index}`}
                    onClick={() => onInspectEnemy?.(enemy)}
                  >
                    <span className="expedition-combat-preview__portrait">
                      {portrait ? (
                        <img
                          src={portrait}
                          alt=""
                          onError={event => applyCombatArtFallback(event, COMBAT_ART_FALLBACKS.enemy)}
                        />
                      ) : (
                        <span aria-hidden="true">?</span>
                      )}
                    </span>
                    <span className="expedition-combat-preview__enemy-copy">
                      <strong>{enemy.name}</strong>
                      {tag && <small>{tag}</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {modifiers.length > 0 && (
            <section className="expedition-combat-preview__block">
              <h3>Условия боя</h3>
              <div className="expedition-combat-preview__modifiers">
                {modifiers.map(modifier => (
                  <div className="expedition-combat-preview__modifier" key={modifier.id}>
                    <span className="expedition-combat-preview__modifier-icon">{modifier.symbol}</span>
                    <div>
                      <strong>{modifier.title}</strong>
                      <StatusLinkedText>{modifier.description}</StatusLinkedText>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {curses.length > 0 && (
            <section className="expedition-combat-preview__block expedition-combat-preview__block--compact">
              <h3>Активные проклятия</h3>
              <div className="expedition-combat-preview__curses">
                {curses.map(curse => {
                  const definition = getCurseDefinition(curse.id);
                  return (
                    <span
                      className="expedition-combat-preview__curse"
                      key={curse.id}
                      style={definition?.presentation?.accent ? { '--curse-accent': definition.presentation.accent } : undefined}
                    >
                      <b aria-hidden="true">{definition?.presentation?.symbol || '◆'}</b>
                      {curse.name} {ROMAN[curse.tier]}
                    </span>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      <footer className="expedition-combat-preview__actions">
        <div className="expedition-combat-preview__preparation">
          <div className="expedition-combat-preview__preparation-header">
            <span>Здоровье: {Math.max(0, Math.round(player?.hp ?? 0))} / {Math.round(player?.maxHp ?? 0)}</span>
            <button type="button" className="secondary" aria-expanded={prepItemsOpen} onClick={() => setPrepItemsOpen(value => !value)}>
              Предметы перед боем ({fieldItems.length})
            </button>
          </div>
          {prepItemsOpen && <div className="expedition-combat-preview__field-list" aria-label="Предметы для подготовки">
            {fieldItems.length === 0 ? <p>Нет предметов, применимых вне боя.</p> : fieldItems.map(({ slotIndex, stack, definition, capability }) => (
              <div className="expedition-combat-preview__field-item" key={slotIndex}>
                <div><strong>{definition.name || stack.itemId}</strong> <small>× {stack.quantity}</small><small>{definition.description}</small></div>
                <button type="button" disabled={!capability.available || !onUseFieldItem} title={capability.reason || ''} onClick={() => onUseFieldItem?.(slotIndex)}>
                  Использовать
                </button>
              </div>
            ))}
          </div>}
        </div>
        <div className="expedition-combat-preview__autobattle">
          <label>
            <input
              type="checkbox"
              disabled={!autobattleUnlocked}
              aria-describedby={!autobattleUnlocked || player?.autobattleEnabled ? 'autobattle-availability' : undefined}
              checked={autobattleUnlocked && Boolean(player?.autobattleEnabled)}
              onChange={event => { if (autobattleUnlocked) onAutobattleChange?.(event.target.checked); }}
            />
            Автобой
          </label>
          {!autobattleUnlocked && <small id="autobattle-availability">Победите босса этой локации хотя бы один раз, чтобы открыть автобой.</small>}
          {autobattleUnlocked && player?.autobattleEnabled && <small id="autobattle-availability">После расчёта можно принять результат или сыграть вручную. Отступить уже нельзя.</small>}
        </div>
        <div className="expedition-combat-preview__action-buttons">
          <button type="button" className="secondary" onClick={onRetreat}>Отойти</button>
          <button type="button" className="primary" onClick={() => onEnter?.(room)}>Вступить в бой</button>
        </div>
      </footer>
    </section>
  );
};

export default ExpeditionCombatPreview;


