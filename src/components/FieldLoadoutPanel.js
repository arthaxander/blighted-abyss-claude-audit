import React, { useEffect, useState } from 'react';
import { FIELD_CRAFTING_RECIPES } from '../data/recipes';
import { resolveItemArt } from '../data/itemArt';
import {
  FIELD_RECIPE_SLOTS,
  normalizeFieldLoadout,
  isFieldLoadoutLocked,
  setFieldLoadout,
  getFieldPresets,
  saveFieldPreset,
  applyFieldPreset,
} from '../data/fieldCraftingLoadout';
import './FieldLoadoutPanel.css';

const recipeById = new Map(FIELD_CRAFTING_RECIPES.map(recipe => [recipe.id, recipe]));

function RecipeArt({ name }) {
  const [failed, setFailed] = useState(false);
  const art = resolveItemArt(name);
  useEffect(() => setFailed(false), [art]);
  return <span className="field-loadout-art" aria-hidden="true">
    {art && !failed
      ? <img src={art} alt="" draggable={false} onError={() => setFailed(true)} />
      : <span>◇</span>}
  </span>;
}

export default function FieldLoadoutPanel({ player, onUpdatePlayer, standalone = false }) {
  const selected = normalizeFieldLoadout(player?.fieldCraftingLoadout);
  const presets = getFieldPresets(player);
  const [editingSlot, setEditingSlot] = useState(null);
  const [editingPreset, setEditingPreset] = useState(null);
  const [names, setNames] = useState({});
  const [status, setStatus] = useState('');
  const locked = isFieldLoadoutLocked(player);
  const update = action => onUpdatePlayer?.(previous => action(previous));
  const filled = selected.filter(Boolean).length;
  const slot = editingSlot === null ? null : FIELD_RECIPE_SLOTS[editingSlot];
  const options = slot ? FIELD_CRAFTING_RECIPES.filter(recipe =>
    recipe.category !== 'survival' && (slot.category === 'any' || slot.category === recipe.category)
  ) : [];

  useEffect(() => {
    if (editingSlot === null) return undefined;
    const handleKey = event => {
      if (event.key === 'Escape') setEditingSlot(null);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [editingSlot]);

  const setRecipe = (index, recipeId) => {
    if (locked) return;
    update(previous => {
      const next = normalizeFieldLoadout(previous.fieldCraftingLoadout);
      next[index] = recipeId;
      return setFieldLoadout(previous, next);
    });
    setEditingSlot(null);
    setStatus('');
  };

  return (
    <details className="field-loadout" open={standalone ? true : undefined}>
      <summary className="field-loadout-summary">
        <span className="field-loadout-summary-title">Полевой набор</span>
        <span className="field-loadout-summary-meta">{filled}/{FIELD_RECIPE_SLOTS.length} рецептов <span aria-hidden="true">⌄</span></span>
      </summary>
      <div className="field-loadout-body">
        <div className="field-loadout-hint">
          Выбери 2 зелья, 2 свитка, западню и универсальный рецепт. Медицина выживания доступна всегда.
          <span> Настройки сохраняются автоматически.</span>
        </div>
        {locked && <p className="field-loadout-status" role="status">Изменить набор можно после возвращения из похода.</p>}

        <div className="field-loadout-grid" aria-label="Рецепты полевого набора">
          {FIELD_RECIPE_SLOTS.map((entry, index) => {
            const recipe = recipeById.get(selected[index]);
            return <button
              type="button"
              className="field-loadout-slot"
              key={entry.label}
              aria-label={`Изменить: ${entry.label}`}
              disabled={locked}
              onClick={() => setEditingSlot(index)}
            >
              <RecipeArt name={recipe?.name} />
              <span className="field-loadout-slot-copy">
                <small>{entry.label}</small>
                <strong>{recipe?.name || 'Не выбран'}</strong>
              </span>
              <span className="field-loadout-slot-chevron" aria-hidden="true">›</span>
            </button>;
          })}
        </div>

        <div className="field-loadout-presets">
          <div className="field-loadout-presets-title">
            <strong>Сохранённые наборы</strong>
            <small>Быстрая смена в Гильдии</small>
          </div>
          {presets.map((preset, index) => {
            const name = names[index] ?? preset?.name ?? `Набор ${index + 1}`;
            return <div className="field-loadout-preset" key={index}>
              <span className="field-loadout-preset-index">{index + 1}</span>
              {editingPreset === index
                ? <input
                    className="field-loadout-preset-input"
                    aria-label={`Название набора ${index + 1}`}
                    maxLength={32}
                    autoFocus
                    value={name}
                    disabled={locked}
                    onChange={event => setNames(previous => ({ ...previous, [index]: event.target.value }))}
                    onKeyDown={event => {
                      if (event.key === 'Enter') { event.preventDefault(); setEditingPreset(null); }
                      if (event.key === 'Escape') setEditingPreset(null);
                    }}
                  />
                : <span className="field-loadout-preset-name">{name}</span>}
              <button
                type="button"
                className="field-loadout-preset-rename"
                aria-label={editingPreset === index ? `Готово: набор ${index + 1}` : `Переименовать набор ${index + 1}`}
                disabled={locked}
                onClick={() => setEditingPreset(editingPreset === index ? null : index)}
              >{editingPreset === index ? '✓' : '✎'}</button>
              <button
                type="button"
                className="field-loadout-preset-save"
                disabled={locked}
                onClick={() => {
                  update(previous => saveFieldPreset(previous, index, name));
                  setEditingPreset(null);
                  setStatus(`Набор ${index + 1} сохранён`);
                }}
              >Сохранить {index + 1}</button>
              <button
                type="button"
                className="field-loadout-preset-apply"
                disabled={locked || !preset}
                onClick={() => {
                  update(previous => applyFieldPreset(previous, index));
                  setStatus(`Набор ${index + 1} применён`);
                }}
              >Применить {index + 1}</button>
            </div>;
          })}
          {status && <p className="field-loadout-feedback" role="status">{status}</p>}
        </div>
      </div>

      {slot && <div className="field-loadout-picker-overlay" role="presentation" onClick={() => setEditingSlot(null)}>
        <section
          className="field-loadout-picker"
          role="dialog"
          aria-modal="true"
          aria-label={`Выбор рецепта: ${slot.label}`}
          onClick={event => event.stopPropagation()}
        >
          <header className="field-loadout-picker-header">
            <div>
              <small>Полевой набор</small>
              <h3>{slot.label}</h3>
            </div>
            <button type="button" autoFocus onClick={() => setEditingSlot(null)} aria-label="Закрыть выбор рецепта">×</button>
          </header>
          <div className="field-loadout-picker-options">
            <button
              type="button"
              className="field-loadout-option is-empty"
              aria-label="Очистить слот"
              onClick={() => setRecipe(editingSlot, null)}
            >
              <RecipeArt name={null} />
              <span><strong>Не выбран</strong><small>Освободить слот</small></span>
            </button>
            {options.map(recipe => {
              const occupied = selected.includes(recipe.id) && selected[editingSlot] !== recipe.id;
              const active = selected[editingSlot] === recipe.id;
              return <button
                type="button"
                className={`field-loadout-option${active ? ' is-active' : ''}`}
                aria-label={`Выбрать: ${recipe.name}`}
                aria-current={active ? 'true' : undefined}
                disabled={occupied}
                onClick={() => setRecipe(editingSlot, recipe.id)}
                key={recipe.id}
              >
                <RecipeArt name={recipe.name} />
                <span className="field-loadout-option-text">
                  <strong>{recipe.name}</strong>
                  <small>Этаж {recipe.abyssLevel || 1}+{occupied ? ' · Уже в наборе' : ''}</small>
                  {recipe.description && <small className="field-loadout-option-effect">{recipe.description}</small>}
                </span>
                {active && <span className="field-loadout-option-check" aria-hidden="true">✓</span>}
              </button>;
            })}
          </div>
          <footer className="field-loadout-picker-footer">Рецепты II этажа можно выбрать заранее, но изготовить — только на соответствующем этаже.</footer>
        </section>
      </div>}
    </details>
  );
}
