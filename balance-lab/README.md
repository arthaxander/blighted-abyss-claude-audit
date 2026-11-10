# Ashen Abyss Balance Lab

Локальное desktop-приложение для балансировки Ashen Abyss без Codex.

## Что умеет

- запускает production-совместимый run simulator;
- основные профили не требуют ручной сборки:
  - Новичок = fresh;
  - Освоившийся = established;
  - Прокачанный = prepared;
- позволяет опционально переопределить реликвию, способности, пассивы, реализованные таланты, экипировку и расходники;
- показывает ключевые метрики маршрута, босса и strong-встреч;
- экспортирует полный JSON и компактный Markdown для передачи в ChatGPT;
- Build Finder ищет Top 3–5 билдов, показывает разницу с первым и 95% статистический интервал;
- финалисты и исходная сборка перепроверяются на общей новой последовательности seed, не использованной при отборе;
- ручные настройки задают исходную сборку; Finder меняет только отмеченные категории;
- отчёт показывает разницу с исходной сборкой, расходники на поход и число отклонённых кандидатов.

## Локальный запуск

Из корня репозитория:

    npm install
    npm --prefix balance-lab install
    npm run balance-lab

## Windows portable EXE

    npm --prefix balance-lab install
    npm run balance-lab:dist

Готовая сборка появляется в balance-lab/dist.

## Важный принцип

Balance Lab не содержит отдельной копии боевой математики. Он импортирует тот же src/utils/runSimulator.js и связанные production-данные, что и игра. Это уменьшает риск расхождения симулятора с реальной механикой.

## Сборки и хранение

Windows EXE собирается только через ручной `workflow_dispatch` или локальную команду.
Изменения игры и деплой production не запускают сборку Balance Lab.
PR с изменениями Lab запускает проверки и короткий smoke-test без загрузки артефактов.
Ручной workflow загружает только EXE со сроком хранения один день.

Lab не сохраняет историю автоматически. Экспорт выполняется явно через диалог сохранения.
Для локальных экспортов внутри проекта используйте `balance-lab/reports/` или
`balance-lab/results/`: они, `dist/`, `.cache/` и вложенный `node_modules/` исключены из git.
Поиск удерживает компактные метрики лучших промежуточных кандидатов; подробные
отчёты отдельных симуляций всё ещё могут требовать значительной памяти.
Существующие GitHub-артефакты эти изменения не удаляют.

## Проверка

    node --test balance-lab/tests/*.test.cjs
    node balance-lab/smoke.cjs

Первая команда проверяет поиск на контролируемом симуляторе без зависимостей.
Вторая требует установленных зависимостей игры и проверяет настоящий симулятор.

## Границы текущего поиска

Поиск пока оптимизирует прохождение старого сценария маршрута через `runSimulator`.
Это не полноценный поход по актуальной гекс-карте. Рейтинг относится к выбранным
политикам маршрута, боя и расходников. Общие seed не гарантируют идентичные встречи,
если билды привели к разным решениям на маршруте. Интервалы Wilson для каждого билда
не являются тестом статистической значимости разницы между двумя билдами.

Дальнейшие этапы: [ROADMAP.md](ROADMAP.md).


### Shared execution and opt-in recordings

The combat screen and combat simulator dispatch `advance`, `ability` and `item`
commands through `src/utils/combatExecution.js`. Production combat still owns
legality, effects and turn consumption. The simulator no longer replaces global
`Math.random`: seeded combat hooks use the session RNG, whose state is restorable.

`simulateCombat({ ...scenario, captureRecording: true })` returns a versioned
`recording` for production-baseline encounters. Ordinary searches do not record
commands. Experimental balance variants are rejected when recording is requested.
A recording contains initial/final diagnostic snapshots and at most 2,000 commands
with RNG states and compact divergence checksums; exceeding the limit throws.
Nothing is automatically saved, committed or uploaded.

To replay, create a fresh session with the same scenario, initialization order,
seed and engine revision, then call `replayCombatRecording(session, recording)`.
The replay executes recorded choices without rerunning the bot policy and checks
initial state, every command and final state. JSON round trips are supported;
recordings are diagnostic data, not authenticated saves or portable hydration of
ability functions. Keep the original scenario and code revision alongside them.

The expedition encounter preview offers opt-in autobattle only after the first
boss victory in that specific location. Unlocks are account-wide and survive
death and class changes. A saved enabled preference cannot bypass the location
gate. Already committed encounters still resume normally. Old saves without
boss history unlock nothing unless a currently completed boss is identifiable. The encounter is
saved before calculation; the result is saved before being shown. The player may
accept it or choose one final manual attempt from the initial snapshot. Neither
calculation nor review applies rewards, death or inventory changes. Acceptance
uses normal combat finalization; manual selection is saved before entering combat.
The encounter cannot be retreated from after autobattle starts. Failed saves keep
the choice blocked; a calculation failure permits manual play from the same start.
Guest sessions remain nonpersistent, as elsewhere in the game.

Autobattle uses the boss-aware policy and the shared production command executor,
with a 1,000-command guard and periodic yielding. It stores only the current
encounter's initial/final snapshots, not a command recording or history. Full
expedition parity for Balance Lab and a diagnostic replay UI remain follow-up work.
Simulator report version is now 3.


### Гекс-карты

По умолчанию интерфейс запускает полную зачистку одной ветки настоящей гекс-карты.
Можно выбрать конкретную схему или случайную из набора, ветку 1–3, seed,
политику обычного боя и босса, а также полевой крафт. Просмотр показывает
наполнение первого seed, а не итоги прохождения персонажем. Для гоблинов
используется одна схема, присутствующая в production; остальные три из отдельной
ветки сюда не добавляются.

Гоблины, Грибы, Отступники, Лес Увядания, Руины Неупокоенных и Шахты Тления
доступны для расчётов. Руины и Шахты используют свои авторские тройки врагов,
сильные группы, проклятых одиночек и боссов, без подмены случайными врагами.
Finder использует выбранную
карту/ветку и общую последовательность seed для сравниваемых билдов, затем
проверяет финалистов на другой общей последовательности.

Ограничения: рыбалка, автоматическая смена найденной
экипировки и эвакуация пока не моделируются. Сравнение относится к полной
зачистке и выбранным политикам. Прежняя модель окон остаётся отдельным режимом.
В отчётах сохраняются настройки и агрегаты по схемам; карты и боевые трассы
не накапливаются. Экспорт только по кнопке, CI не загружает новые артефакты.


Алтари используют общие правила игры, а не отдельную таблицу симулятора:

| Этаж | Алтарей на активном маршруте | Предел одного проклятия |
|---|---|---|
| 1 | 1 | I |
| 2 | 2 | II |
| 3 | 2–3 | IV |
| 4 | 2–3 | V |
| 5 | 3–4 | V |
| 6 | Добор оставшихся уровней до общей суммы 13 | V |

Количество ограничивается оставшимся прогрессом до 13. Это доступные предложения,
а не гарантированные принятые уровни. Алтарь сохраняет два разных случайных предложения из допустимых
проклятий (или одно, если осталось только одно); политика может принять его, отказаться от III+ или пропустить любой алтарь.
Выше II развивается только одно главное проклятие. Начальные проклятия задаются
явно; несколько главных, дробные уровни и превышение предела этажа запрещены.
Поход не получает эти уровни заранее: эффект появляется только после посещённого
и принятого алтаря. Смерть до алтаря не засчитывает его принятие.

Finder сохраняет начальные проклятия и политику алтарей у всех кандидатов.
Это пока поиск экипировки/навыков при заданных условиях, не оптимизация выбора
проклятий. Текущие боевые сценарии доступны для этажей 1–2; правила 3–6 проверены
на уровне планирования карт и принятия проклятий, без заявления о готовых походах
на отсутствующие этажи. Отчёт содержит числа предусмотренных/посещённых/принятых/
пропущенных алтарей и средние конечные уровни проклятий, без записи каждого прогона.


На алтаре можно выбрать одно из двух предложений или отказаться от обоих.
Предложения сохраняются в комнате и в открытом событии, без переброса при
перезагрузке. Старые сохранённые алтари с одним проклятием сохраняют его.
В симуляторе заданный приоритет выбирается только из предложенного; иначе
повышается уже взятое допустимое проклятие, при равенстве выбирается первое.
Политика «только до II» фильтрует недопустимое для неё предложение перед выбором.
Приоритет одинаков для всех кандидатов Finder и сохраняется в отчёте.
