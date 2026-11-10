import React, { useMemo, useRef, useState } from "react";
import {
  addCustomCombatEnemy,
  CUSTOM_COMBAT_MAX_ENEMIES,
  getCustomCombatEnemyCatalog,
  moveCustomCombatEnemy,
} from "../utils/customCombat";

const panel = { maxWidth: 680, margin: "20px auto", padding: 16, color: "#eee", background: "#1b1b1d", borderRadius: 10 };
const button = { margin: 4, padding: "7px 10px" };

export default function CustomCombatScreen({ onStart, onClose }) {
  const catalog = useMemo(() => getCustomCombatEnemyCatalog(), []);
  const [definitionId, setDefinitionId] = useState(catalog[0]?.id || "");
  const [selection, setSelection] = useState([]);
  const sequenceRef = useRef(0);
  const byId = useMemo(() => new Map(catalog.map(entry => [entry.id, entry])), [catalog]);
  const limitReached = selection.length >= CUSTOM_COMBAT_MAX_ENEMIES;

  const addEnemy = () => {
    setSelection(current => addCustomCombatEnemy(current, definitionId, sequenceRef.current++));
  };

  return (
    <main style={panel}>
      <h2>Кастомный бой</h2>
      <p>DEV-инструмент: бой не сохраняется и не выдаёт награды.</p>
      <div>
        <select value={definitionId} onChange={event => setDefinitionId(event.target.value)} style={{ maxWidth: "100%" }}>
          {catalog.map(enemy => (
            <option key={enemy.id} value={enemy.id}>
              {enemy.name} · {enemy.location} · {enemy.category}
            </option>
          ))}
        </select>
        <button style={button} onClick={addEnemy} disabled={!definitionId || limitReached}>Добавить</button>
      </div>
      {limitReached ? <p role="status">Достигнут лимит: 6 стартовых врагов.</p> : null}
      <ol>
        {selection.map((entry, index) => (
          <li key={entry.selectionId}>
            {byId.get(entry.definitionId)?.name || entry.definitionId}
            <button style={button} onClick={() => setSelection(current => moveCustomCombatEnemy(current, index, -1))} disabled={index === 0}>↑</button>
            <button style={button} onClick={() => setSelection(current => moveCustomCombatEnemy(current, index, 1))} disabled={index === selection.length - 1}>↓</button>
            <button style={button} onClick={() => setSelection(current => current.filter(item => item.selectionId !== entry.selectionId))}>Удалить</button>
          </li>
        ))}
      </ol>
      <button style={button} onClick={() => setSelection([])} disabled={!selection.length}>Очистить</button>
      <button style={button} onClick={() => onStart(selection, catalog)} disabled={!selection.length}>Начать бой</button>
      <button style={button} onClick={onClose}>Вернуться</button>
    </main>
  );
}
