import React from "react";
import {
  EQUIPMENT_SLOT_KEYS,
  EQUIPMENT_SLOT_LABELS,
} from "../utils/equipmentManager";
import { getEquipmentInstanceItemId } from "../utils/runeSockets";
import { hideMissingItemArt, resolveItemArt } from "../data/itemArt";
import { DefenseInfoButton } from "./DefenseInfoDialog";

export const EquipmentPaperDoll = ({ equipment, portrait, onInspect }) => (
  <div className="equipment-paper-doll" aria-label="Экипировка персонажа">
    <div className="equipment-paper-doll__figure" aria-hidden="true">
      {portrait ? (
        <img src={portrait} alt="" />
      ) : (
        <span className="equipment-paper-doll__silhouette" />
      )}
    </div>
    {EQUIPMENT_SLOT_KEYS.map((slot) => {
      const item = equipment?.[slot];
      const itemId = getEquipmentInstanceItemId(item);
      return (
        <button
          key={slot}
          type="button"
          data-equipment-slot={slot}
          className={`equipment-paper-slot${itemId ? " is-occupied" : ""}`}
          disabled={!itemId}
          onClick={() => itemId && onInspect?.(slot, item)}
          aria-label={`${EQUIPMENT_SLOT_LABELS[slot]}: ${itemId || "Пусто"}`}
        >
          {itemId && resolveItemArt(item || itemId) ? (
            <img
              className="equipment-item-art"
              src={resolveItemArt(item || itemId)}
              alt=""
              onError={hideMissingItemArt}
            />
          ) : (
            <span>{EQUIPMENT_SLOT_LABELS[slot]}</span>
          )}
          <small>{itemId || "Пусто"}</small>
        </button>
      );
    })}
  </div>
);

export const CharacterStatsGrid = ({ stats }) => (
  <section
    className="inventory-stats guild-character-stats"
    aria-label="Характеристики персонажа"
  >
    <dl>
      {stats.map(([label, value, statKey]) => (
        <div key={label}>
          <dt>{label}{statKey && <DefenseInfoButton statKey={statKey} value={value} />}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  </section>
);
