import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import EnemyDetailCard from "./EnemyDetailCard";
import { createEnemyInstanceByName } from "../data/enemies";

const renderEnemy = name => render(
  <EnemyDetailCard enemy={createEnemyInstanceByName(name)} onClose={jest.fn()} />
);

describe("EnemyDetailCard", () => {
  test('shows custom expedition modifiers without duplicating the global Abyss Power', () => {
    render(<EnemyDetailCard enemy={{
      name: 'Цель', hp: 10, maxHp: 10, abilities: [],
      expeditionModifiers: [
        { id: 'abyss-power', label: '[Мощь Бездны]', tuning: null },
        { id: 'special-region', label: '[Особый эффект локации]' },
      ],
    }} onClose={jest.fn()} />);
    expect(screen.queryByText('[Мощь Бездны]')).not.toBeInTheDocument();
    expect(screen.getByText('[Особый эффект локации]')).toBeInTheDocument();
  });
  test('uses compact icon status rows whose status reference opens GameTerm help', () => {
    render(<EnemyDetailCard enemy={{ name: 'Цель', hp: 10, maxHp: 10, abilities: [], effects: [{ id: 'speed_penalty_major', remainingTurns: 2 }] }} onClose={jest.fn()} />);
    const status = screen.getByRole('button', { name: '[Сильное замедление]' });
    expect(status.closest('.player-combat-status')).toHaveTextContent('2 х.');
    expect(status.closest('.player-combat-status').querySelector('.player-combat-status__icon')).toBeInTheDocument();
    fireEvent.click(status);
    expect(screen.getByRole('dialog', { name: 'Статус: Сильное замедление' })).toBeInTheDocument();
  });
  test('hides permanent sentinel durations, preserves timed durations, and shows useful stacks', () => {
    render(<EnemyDetailCard enemy={{ name: 'Дуэлянт', hp: 10, maxHp: 10, abilities: [], effects: [{ id: 'combat_rhythm', remainingTurns: 999, stacks: 3 }, { id: 'bleed', remainingTurns: 2 }] }} onClose={jest.fn()} />);
    expect(screen.getByRole('button', { name: '[Боевой ритм]' }).closest('.player-combat-status')).toHaveTextContent('×3');
    expect(screen.getByRole('button', { name: '[Боевой ритм]' }).closest('.player-combat-status')).not.toHaveTextContent('999 х.');
    expect(screen.getByRole('button', { name: '[Кровотечение]' }).closest('.player-combat-status')).toHaveTextContent('2 х.');
  });

  test('presents innate control immunity as a permanent trait and keeps Blind outside it', () => {
    renderEnemy('Мастер клинков');
    const traits = screen.getByRole('region', { name: 'Постоянные свойства' });
    expect(traits).toHaveTextContent('Иммунитет к контролю');
    expect(traits).toHaveTextContent(/Оглушение/);
    expect(traits).not.toHaveTextContent('Слепота');
    expect(screen.queryByRole('button', { name: '[Иммунитет к контролю]' })).not.toBeInTheDocument();
  });
  test("separates Ripper signature active and passive abilities with art", () => {
    renderEnemy("Гоблин-Потрошитель");
    const actives = screen.getByRole("region", { name: "Активные способности" });
    const passives = screen.getByRole("region", { name: "Пассивные способности" });

    expect(within(actives).getByRole("button", { name: /Мясной вихрь/ })).toBeInTheDocument();
    expect(within(actives).getByRole("img", { hidden: true })).toHaveAttribute(
      "src", "/assets/combat/abilities/goblin_nests/meat_whirlwind.webp"
    );
    expect(within(passives).getByRole("button", { name: /Кровожадность/ })).toBeInTheDocument();
    expect(within(passives).getByRole("img", { hidden: true })).toHaveAttribute(
      "src", "/assets/combat/abilities/goblin_nests/bloodlust.webp"
    );
    expect(screen.queryByRole("button", { name: /^Атака/ })).not.toBeInTheDocument();
  });

  test("keeps all five Crystalbreaker signatures compact and expands only one description", () => {
    renderEnemy("Искажённый гоблин-кристаллолом");
    const signatureNames = [
      "Кристаллический надлом", "Кристаллический срыв", "Кристальный удар",
      "Осколочный рывок", "Хрустальный панцирь",
    ];
    signatureNames.forEach(name => expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument());
    expect(screen.getAllByRole("button", { expanded: false }).filter(button => button.classList.contains('enemy-detail-ability-toggle'))).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: /Кристаллический надлом/ }));
    expect(screen.getByText(/Если прямой удар снимает более 20%/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Осколочный рывок/ }));
    expect(screen.queryByText(/Если прямой удар снимает более 20%/)).not.toBeInTheDocument();
    expect(screen.getByText(/Наносит 145% атаки физическим уроном/)).toBeVisible();
  });

  test.each([
    ["Гоблин-палач", ["Приговор палача", "Казнящий удар"]],
    ["Крысиный матриарх", ["Зов помёта", "Грызущая пасть", "Кормление стаи"]],
    ["Пепельный Колпак Рагшнар", ["Инферно", "Пылающий щит", "Огненный взрыв"]],
  ])("renders every signature ability for %s", (enemyName, abilityNames) => {
    renderEnemy(enemyName);
    abilityNames.forEach(name => {
      const button = screen.getByRole("button", { name: new RegExp(name) });
      expect(button).toBeInTheDocument();
      expect(button.querySelector("img")).toHaveAttribute("src", expect.stringMatching(/goblin_nests\/.+\.webp$/));
    });
  });

  test("shows Ragshnar's authoritative Magical Attack", () => {
    renderEnemy("Пепельный Колпак Рагшнар");
    const stats = screen.getByRole("region", { name: "Боевые характеристики" });
    expect(within(stats).getByText("Маг. атака").parentElement).toHaveTextContent("14");
  });

  test('physical and magical defense expose the same canonical mitigation help', () => {
    render(<EnemyDetailCard enemy={{ name: 'Бронник', hp: 100, maxHp: 100, physDef: 42, magicDef: 18, abilities: [], effects: [] }} onClose={jest.fn()} />);
    expect(screen.getByText('Физ. защ.')).toBeInTheDocument();
    expect(screen.getByText('Маг. защ.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Физическая защита' }));
    expect(screen.getByRole('dialog', { name: 'Физическая защита' })).toHaveTextContent('примерно 30%');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.getByRole('dialog', { name: 'Бронник' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Подробнее: Магическая защита' }));
    expect(screen.getByRole('dialog', { name: 'Магическая защита' })).toHaveTextContent('примерно 15%');
  });

  test('shows authoritative dodge and critical percentages including combat defaults', () => {
    const { rerender } = render(<EnemyDetailCard enemy={{ name: 'Дуэлянт', hp: 50, maxHp: 50, dodge: 0.08, critChance: 0.22, critDamage: 0.85, abilities: [], effects: [] }} onClose={jest.fn()} />);
    expect(screen.getByText('Уворот').parentElement).toHaveTextContent('8%');
    expect(screen.getByText('Крит. шанс').parentElement).toHaveTextContent('22%');
    expect(screen.getByText('Крит. урон').parentElement).toHaveTextContent('185%');

    rerender(<EnemyDetailCard enemy={{ name: 'Обычный', hp: 50, maxHp: 50, abilities: [], effects: [] }} onClose={jest.fn()} />);
    expect(screen.getByText('Крит. шанс').parentElement).toHaveTextContent('10%');
    expect(screen.getByText('Крит. урон').parentElement).toHaveTextContent('150%');
  });

  test("uses a graceful marker when an ability has no registered artwork", () => {
    render(
      <EnemyDetailCard
        enemy={{
          name: "Безликий", hp: 1, maxHp: 1,
          abilities: [{ name: "Неизвестный приём", description: "Тайна" }],
        }}
        onClose={jest.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /Неизвестный приём/ })).toBeInTheDocument();
    expect(screen.getByText("✦")).toBeInTheDocument();
  });

  test("close control remains accessible", () => {
    const onClose = jest.fn();
    render(<EnemyDetailCard enemy={createEnemyInstanceByName("Крысомант из Нор")} onClose={onClose} />);
    expect(screen.getByRole("button", { name: /Крысиный зов/ }).querySelector("img")).toHaveAttribute(
      "src", "/assets/combat/abilities/goblin_nests/rat_call.webp"
    );
    fireEvent.click(screen.getByRole("button", { name: "Закрыть сведения о враге" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("status references open authoritative help without collapsing the ability", () => {
    renderEnemy("Гоблин-палач");
    const ability = screen.getByRole("button", { name: /Казнящий удар/ });
    fireEvent.click(ability);
    const status = screen.getByRole("button", { name: "[Уязвимостью]" });
    expect(status).toHaveTextContent("[Уязвимостью]");
    expect(status.className).not.toMatch(/underline/);
    expect(status.querySelector("u")).not.toBeInTheDocument();
    expect(status).not.toHaveAttribute("href");
    fireEvent.click(status);
    expect(ability).toHaveAttribute("aria-expanded", "true");
    const info = screen.getByRole("dialog", { name: "Статус: Уязвимость" });
    expect(info).toHaveTextContent("Цель получает на 25% больше урона");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть описание статуса Уязвимость" }));
    expect(screen.queryByRole("dialog", { name: "Статус: Уязвимость" })).not.toBeInTheDocument();
    expect(ability).toHaveAttribute("aria-expanded", "true");
  });

  test('redesigned Mushroom ability keeps interactive Poison help inside enemy details', () => {
    renderEnemy('Троглодит-заражённый');
    const ability = screen.getByRole('button', { name: /Заражённый выпад/ });
    fireEvent.click(ability);
    fireEvent.click(screen.getByRole('button', { name: '[Отравление]' }));
    expect(screen.getByRole('dialog', { name: 'Статус: Отравление' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть описание статуса Отравление' }));
    expect(ability).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Троглодит-заражённый' })).toBeInTheDocument();
  });

  test("multiple active status references work and ordinary text remains readable", () => {
    renderEnemy("Пепельный Колпак Рагшнар");
    fireEvent.click(screen.getByRole("button", { name: /Огненный взрыв/ }));
    expect(screen.getByText(/Наносит всем противникам/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "[Горение]" }));
    expect(screen.getByRole("dialog", { name: "Статус: Горение" })).toHaveTextContent("50% атакующей характеристики");
    expect(screen.getByRole("dialog", { name: "Статус: Горение" })).toHaveTextContent("3% максимального здоровья");
    fireEvent.click(screen.getByRole("button", { name: "[Слепоту]" }));
    expect(screen.getByRole("dialog", { name: "Статус: Слепота" })).toHaveTextContent("30 процентных пунктов");
  });

  test("passive status references work and missing metadata degrades to plain text", () => {
    const enemy = createEnemyInstanceByName("Гоблин-Потрошитель");
    enemy.abilities.push({
      name: "Неполная запись",
      description: "Неизвестный статус остаётся текстом.",
      descriptionParts: [{ statusId: "missing_status", text: "Неизвестный статус" }, " остаётся текстом."],
    });
    render(<EnemyDetailCard enemy={enemy} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Кровожадность/ }));
    fireEvent.click(screen.getByRole("button", { name: "[Кровотечением]" }));
    expect(screen.getByRole("dialog", { name: "Статус: Кровотечение" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Неполная запись/ }));
    expect(screen.getByText("Неизвестный статус", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Неизвестный статус" })).not.toBeInTheDocument();
  });

  test("brackets multiple status references without changing ordinary or fallback text", () => {
    render(
      <EnemyDetailCard
        enemy={{
          name: "Проверочный враг",
          hp: 10,
          maxHp: 10,
          abilities: [{
            name: "Сдвоенный эффект",
            description: "Накладывает Отравление и Кровотечение на 1 ход.",
            descriptionParts: [
              "Накладывает ",
              { statusId: "poison", text: "Отравление" },
              " и ",
              { statusId: "bleed", text: "Кровотечение" },
              " на 1 ход.",
            ],
          }],
        }}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Сдвоенный эффект/ }));
    expect(screen.getByRole("button", { name: "[Отравление]" })).toHaveTextContent("[Отравление]");
    expect(screen.getByRole("button", { name: "[Кровотечение]" })).toHaveTextContent("[Кровотечение]");
    expect(screen.getByText("Накладывает", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText("[на 1 ход.]", { exact: true })).not.toBeInTheDocument();
  });
});
