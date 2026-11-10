import React, { useMemo, useRef, useEffect, useState } from 'react';
import { findItemData, normalizeItemName } from '../data/items';
import { getSelectedFieldRecipes } from '../data/fieldCraftingLoadout';
import { QUEST_EVENTS, processQuestEvents } from '../data/quests';
import { craftSelectedFieldRecipe } from '../utils/fieldCrafting';
import { useToast } from '../contexts/UIContext';
import CraftRecipeRow from './CraftRecipeRow';
import ItemDetailsModal from './ItemDetailsModal';
import { GuildCategoryTabs } from './guild/GuildItemBrowser';
import './FieldCraftingModal.css';

const CATEGORIES = [
  { id: 'all', label: 'Все' },
  { id: 'medicine', label: 'Зелья' },
  { id: 'scroll', label: 'Свитки' },
  { id: 'trap', label: 'Западни' },
  { id: 'survival', label: 'Медицина' },
];

const countInventoryItems = (runInventory = []) =>
  runInventory.reduce((counts, stack) => {
    const name = normalizeItemName(stack?.itemId);
    if (name) counts[name] = (counts[name] || 0) + (Number(stack.quantity) || 1);
    return counts;
  }, {});

const failureText = reason => ({
  'recipe-not-equipped': 'Рецепт не входит в полевой набор или недоступен на этом этаже',
  'in-combat': 'Создание недоступно в бою',
  'missing-ingredients': 'Недостаточно ингредиентов',
  'insufficient-space': 'В сумке не хватает места',
}[reason] || 'Рецепт недоступен');

export default function FieldCraftingModal({ player, onClose, onUpdatePlayer }) {
  const { pushToast } = useToast();
  const [category, setCategory] = useState('all');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [inspectItem, setInspectItem] = useState(null);
  const [resultText, setResultText] = useState('');
  const submitted = useRef(false);
  const [craftPending, setCraftPending] = useState(false);
  // A ref prevents a double-click in the same frame. The state update is
  // necessary as well: changing the ref alone cannot repaint disabled buttons.
  useEffect(() => {
    submitted.current = false;
    setCraftPending(false);
  }, [player]);

  const recipes = useMemo(() => getSelectedFieldRecipes(player), [player]);
  const ownedCounts = useMemo(() => countInventoryItems(player?.runInventory || []), [player?.runInventory]);
  const assessments = useMemo(() => new Map(recipes.map(recipe => [
    recipe.id,
    recipe.knownByDefault && recipe.craftContext === 'dungeon'
      ? craftSelectedFieldRecipe(player, recipe)
      : { success: false, reason: 'unavailable' },
  ])), [recipes, player]);
  const visibleRecipes = recipes.filter(recipe =>
    (category === 'all' || recipe.category === category) &&
    (!availableOnly || assessments.get(recipe.id)?.success)
  );

  const handleCraft = recipe => {
    if (submitted.current) return;
    const assessment = assessments.get(recipe.id);
    if (!assessment?.success) {
      pushToast(failureText(assessment?.reason), { tone: 'warning' });
      return;
    }
    const resultName = normalizeItemName(recipe.result?.name || recipe.name);
    if (!findItemData(resultName)) {
      pushToast('Рецепт недоступен', { tone: 'warning' });
      return;
    }
    const result = craftSelectedFieldRecipe(player, recipe);
    if (!result.success) {
      pushToast(failureText(result.reason), { tone: 'warning' });
      return;
    }

    if (!onUpdatePlayer) return;
    submitted.current = true;
    setCraftPending(true);
    onUpdatePlayer(previous => {
      const current = craftSelectedFieldRecipe(previous, recipe);
      if (!current.success) return previous;
      const { questLog } = processQuestEvents(previous.questLog, [
        { type: QUEST_EVENTS.CRAFT, item: resultName },
        { type: QUEST_EVENTS.INVENTORY_CHECK, runInventory: current.player.runInventory },
      ], current.player);
      return { ...current.player, questLog };
    });
    setResultText(`Создано: ${resultName}${(recipe.result?.quantity || 1) > 1 ? ` ×${recipe.result.quantity}` : ''}`);
  };

  return <div className="field-crafting-overlay" role="dialog" aria-modal="true" aria-labelledby="field-crafting-title">
    <section className="field-crafting-panel">
      <header className="field-crafting-header">
        <h3 id="field-crafting-title">Полевой крафт</h3>
        <button type="button" onClick={onClose}>Закрыть</button>
      </header>
      {resultText && <div className="field-crafting-result" role="status" aria-live="polite">{resultText}</div>}
      {player?.preparedTrap && <div className="field-crafting-prepared">
        <span>Подготовлена: {player.preparedTrap}</span>
        <button type="button" onClick={() => onUpdatePlayer?.({ preparedTrap: null })}>Отменить подготовку</button>
      </div>}
      <div className="field-crafting-content">
        <GuildCategoryTabs label="Категории полевого крафта" entries={CATEGORIES} value={category} onChange={setCategory} />
        <label className="field-crafting-available">
          <input type="checkbox" checked={availableOnly} onChange={event => setAvailableOnly(event.target.checked)} />
          Можно создать
        </label>
        <div className="guild-recipe-list field-crafting-list" role="list" aria-label="Рецепты">
          {visibleRecipes.map(recipe => {
            const assessment = assessments.get(recipe.id);
            return <CraftRecipeRow key={recipe.id}
              name={recipe.name}
              itemName={recipe.result?.name || recipe.name}
              ingredients={recipe.ingredients.map(req => ({ ...req, name: normalizeItemName(req.name) }))}
              ownedCounts={ownedCounts}
              craftable={Boolean(assessment?.success)}
              disabled={craftPending}
              unavailableReason={failureText(assessment?.reason)}
              onInspectItem={setInspectItem}
              onCraft={() => handleCraft(recipe)}
            />;
          })}
          {visibleRecipes.length === 0 && <p className="field-crafting-empty">
            {availableOnly ? 'Нет рецептов, доступных для создания.' : 'В этой категории нет рецептов из полевого набора.'}
          </p>}
        </div>
      </div>
    </section>
    {inspectItem && <ItemDetailsModal
      item={{ itemId: inspectItem, name: inspectItem }}
      player={player}
      context={{ inspectOnly: true, inDungeon: true }}
      onClose={() => setInspectItem(null)}
    />}
  </div>;
}
