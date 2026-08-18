/**
 * Значения по умолчанию.
 *
 * Каждое число здесь — либо взято из ГДД напрямую, либо подставлено по правилу
 * подстановки (середина указанного диапазона; при отсутствии диапазона —
 * минимальное значение, при котором система проходит свой «Первый срез»).
 * Каждая подстановка — строка в DECISIONS.md.
 */

import type { SnowflowConfig } from "./types.js";

export const defaultConfig: SnowflowConfig = {
  // ── Конфиг партии (владеет Игровой цикл) ─────────────────────────────────
  party: {
    gridCols: 6,
    gridRows: 6,
    towerQuadrant: "C3",
    cityQuadrant: "D4",
    bands: [
      { band: "гражданский", from: 0, to: 100 },
      { band: "военный", from: 100, to: 200 },
      { band: "посты", from: 200, to: 300 },
    ],
    meteoFrequency: 120,
    relayFrequency: 140,
    scenarioStructures: [
      { kind: "склад", quadrant: "B2", integrity: 80, domain: { stock: 60 } },
      { kind: "склад", quadrant: "E5", integrity: 80, domain: { stock: 40 } },
      { kind: "база", quadrant: "D2", integrity: 90, domain: { garrison: 70 } },
      { kind: "пост", quadrant: "A4", integrity: 60 },
      { kind: "пост", quadrant: "F3", integrity: 60 },
      { kind: "ретранслятор", quadrant: "C4", integrity: 70, domain: { gain: 50 } },
      { kind: "ретранслятор", quadrant: "E2", integrity: 70, domain: { gain: 50 } },
    ],
    partyLengthDays: 13,
    loopStepMinutes: 5,
    seed: 20260817,
    minutesPerDay: 24 * 60,
    dawnHour: 7,
    duskHour: 19,
    startingRations: 6,
    startingFuel: 400,
  },

  // ── Погода ───────────────────────────────────────────────────────────────
  weather: {
    tickMinutes: 30,
    stormStartChance: 0.03,
    stormEndChance: 0.12,
    baseTemperature: -20,
    dailyAmplitude: 6,
    driftPerDay: -0.4,
    stormTemperaturePenalty: 12,
  },

  // ── Город ────────────────────────────────────────────────────────────────
  city: {
    start: {
      panic: 20,
      morale: 60,
      trust: 50,
      defence: 50,
      population: 100,
      integrity: 80,
      supply: 50,
    },
    pool: {
      tickMinutes: 60,
      idleWeight: 20,
      events: [
        {
          id: "спокойный_период",
          baseWeight: 10,
          effectOnSelf: [{ stat: "panic", delta: -3 }],
          fact: { eventType: "спокойный_период", status: "без_происшествий" },
        },
        {
          id: "ремонт",
          baseWeight: 6,
          modifiers: [{ stat: "integrity", coef: -0.04 }],
          effectOnSelf: [{ stat: "integrity", delta: 5 }],
          fact: { eventType: "ремонт", status: "завершён" },
        },
        {
          id: "шторм_бьёт_по_целостности",
          baseWeight: 0,
          externalModifiers: [{ source: "погода", coef: 8 }],
          effectOnSelf: [
            { stat: "integrity", delta: -6 },
            { stat: "panic", delta: 2 },
          ],
          fact: { eventType: "шторм_ударил_по_городу", status: "повреждения" },
        },
        {
          id: "бунт",
          baseWeight: 0,
          modifiers: [{ stat: "panic", coef: 0.06 }],
          effectOnSelf: [
            { stat: "morale", delta: -8 },
            { stat: "supply", delta: -5 },
          ],
          fact: { eventType: "бунт", status: "срыв_поставок" },
        },
        {
          id: "хорошие_новости",
          baseWeight: 4,
          effectOnSelf: [
            { stat: "morale", delta: 3 },
            { stat: "panic", delta: -2 },
          ],
          fact: { eventType: "хорошие_новости", status: "объявлено" },
        },
        {
          id: "рост_тревоги",
          baseWeight: 3,
          modifiers: [{ stat: "morale", coef: -0.02 }],
          effectOnSelf: [{ stat: "panic", delta: 4 }],
          fact: { eventType: "рост_тревоги", status: "зафиксирован" },
        },
      ],
    },
    defenceRate: { coefPanic: 0.0006, coefIntegrity: 0.0004, cap: 100 },
    destruction: { weightIntegrity: 0.6, weightPopulation: 0.4 },
    supplyVolume: { coefSupply: 1.6, coefTrust: 1.2, floor: 120 },
    breach: { populationLossPercent: 0.2, integrityLoss: 4, defenceLossFactor: 0.5 },
    supplyEvent: { delivered: 6, lost: -8, lostPanic: 5 },
    verdict: {
      trustTruth: 6,
      trustLie: -10,
      trustInaccuracy: -3,
      panicPerConfirmedThreat: 5,
      moraleFromTone: 12,
    },
    rhetoric: { growthPerApply: 1, decayPerMinute: 0.002, halfSaturation: 3 },
    thresholds: { panicRiot: 80, moraleCollapse: 15, trustIgnored: 10 },
  },

  // ── Структуры ────────────────────────────────────────────────────────────
  structures: {
    pools: {
      склад: {
        tickMinutes: 120,
        idleWeight: 6,
        events: [
          {
            id: "родить_конвой",
            baseWeight: 5,
            modifiers: [{ stat: "stock", coef: 0.05 }],
            effectOnSelf: [{ stat: "stock", delta: -10 }],
            fact: { eventType: "конвой_вышел", status: "в_пути" },
            spawn: { kind: "конвой", stats: { progress: [0, 10], risk: [10, 45] } },
          },
          {
            id: "инвентаризация",
            baseWeight: 3,
            effectOnSelf: [{ stat: "stock", delta: 12 }],
            fact: { eventType: "инвентаризация", status: "завершена" },
          },
        ],
      },
      база: {
        tickMinutes: 90,
        idleWeight: 6,
        events: [
          {
            id: "военная_сводка",
            baseWeight: 4,
            fact: { eventType: "военная_сводка", status: "передана" },
          },
          {
            id: "перегруппировка",
            baseWeight: 3,
            effectOnSelf: [{ stat: "garrison", delta: -5 }],
            fact: { eventType: "перегруппировка", status: "начата" },
          },
        ],
      },
      пост: {
        tickMinutes: 90,
        idleWeight: 8,
        events: [
          { id: "болтовня", baseWeight: 4, fact: { eventType: "болтовня", status: "в_эфире" } },
          { id: "сплетни", baseWeight: 3, fact: { eventType: "сплетни", status: "в_эфире" } },
          { id: "просьба", baseWeight: 2, fact: { eventType: "просьба_о_помощи", status: "передана" } },
        ],
      },
      ретранслятор: {
        // Ретранслятор собственных фактов не генерирует (заметка «Структуры», п.6).
        tickMinutes: 180,
        idleWeight: 1,
        events: [],
      },
    },
    convoyPool: {
      tickMinutes: 30,
      idleWeight: 2,
      events: [
        {
          id: "шаг_по_маршруту",
          baseWeight: 10,
          effectOnSelf: [{ stat: "progress", delta: 20 }],
          fact: { eventType: "конвой_в_пути", status: "в_пути" },
        },
        {
          id: "прибыл",
          baseWeight: 0,
          modifiers: [{ stat: "progress", coef: 0.06 }],
          terminal: true,
          outbound: { event: "поставка_доставлена", to: "город" },
          fact: { eventType: "конвой_прибыл", status: "прибыл" },
        },
        {
          id: "перехвачен",
          baseWeight: 0,
          modifiers: [{ stat: "risk", coef: 0.04 }],
          terminal: true,
          outbound: { event: "поставка_потеряна", to: "город" },
          fact: { eventType: "конвой_перехвачен", status: "перехвачен" },
        },
        {
          id: "погиб_в_шторме",
          baseWeight: 0,
          externalModifiers: [{ source: "погода", coef: 3 }],
          terminal: true,
          outbound: { event: "поставка_потеряна", to: "город" },
          fact: { eventType: "конвой_погиб_в_шторме", status: "погиб" },
        },
      ],
    },
  },

  // ── Фракции ──────────────────────────────────────────────────────────────
  factions: {
    aggressionStart: 50,
    aggressionRange: [0, 100],
    recentWindowMinutes: 720,
    pools: {
      свои: {
        tickMinutes: 60,
        idleWeight: 6,
        events: [
          { id: "координаты_квадрата", baseWeight: 3, fact: { eventType: "координаты_квадрата", status: "переданы" } },
          { id: "шифровка", baseWeight: 3, fact: { eventType: "шифровка", status: "в_эфире" } },
          { id: "оборона_периметра", baseWeight: 2, fact: { eventType: "оборона_периметра", status: "доложено" } },
        ],
      },
      противники: {
        tickMinutes: 60,
        idleWeight: 8,
        events: [
          {
            id: "атака_силой_N",
            baseWeight: 2,
            modifiers: [{ stat: "aggression", coef: 0.03 }],
            externalModifiers: [{ source: "напряжённость", coef: 0.08 }],
            fact: { eventType: "атака", status: "нанесена", archetypeTag: "агрессивное" },
            outbound: { event: "атака_силой_N", to: "маршрутизация_атаки" },
            attackPower: [10, 45],
          },
          {
            id: "перехват_переговоров",
            baseWeight: 3,
            fact: { eventType: "перехват_переговоров", status: "зафиксирован" },
          },
        ],
      },
      мародёры: {
        tickMinutes: 60,
        idleWeight: 6,
        events: [
          { id: "ложный_сигнал_бедствия", baseWeight: 4, fact: { eventType: "сигнал_бедствия", status: "передан" } },
          {
            id: "перехват_приписан_мародёрам",
            baseWeight: 3,
            fact: { eventType: "перехват_приписан_мародёрам", status: "заявлен" },
          },
          { id: "требование_выкупа", baseWeight: 2, fact: { eventType: "требование_выкупа", status: "передано" } },
        ],
      },
    },
  },

  // ── Режиссёр ─────────────────────────────────────────────────────────────
  director: {
    tickMinutes: 60,
    tensionStart: 0,
    coefFromPanic: 1.5,
    coefFromTrustDrop: 1.0,
    dischargeAmount: 20,
    branches: { supplyLost: 30, disinformation: 50, emergencyRaid: 70 },
    raidPower: [45, 75],
    aggressiveWeightCoef: 0.08,
  },

  // ── Генератор эфира ──────────────────────────────────────────────────────
  broadcast: {
    tickMinutes: 15,
    ttlMinutes: 240,
    hearingRadius: { ретранслятор: 3, пост: 2, база: 2 },
    audibility: {
      "структура:пост": "посты",
      "структура:база": "военный",
      "структура:склад": "военный",
      город: "военный",
      конвой: "военный",
      "фракция:свои": "военный",
      "фракция:противники": "гражданский",
      "фракция:мародёры": "гражданский",
      "режиссёр:дезинформация": "гражданский",
      сводка: "военный",
    },
    inaccuracyChance: 0.15,
    lieChanceForAggressive: 0.5,
    divergence: { distanceSpread: 8, timeSpreadMinutes: 180, quadrantShift: 2 },
    meteoHour: 8,
    relayHour: 18,
    phantomEventTypes: [
      "конвой_вышел",
      "атака",
      "сигнал_бедствия",
      "структура_уничтожена",
      "перехват_переговоров",
    ],
    routes: ["через перевал", "вдоль русла", "по старой ветке", "через лес", "по открытой равнине"],
  },

  // ── Радист ───────────────────────────────────────────────────────────────
  radioman: {
    start: { fatigue: 10, hunger: 15, warmth: 70, sanity: 85 },
    tickMinutes: 5,
    fatiguePerMinute: 0.05,
    hungerPerMinute: 0.045,
    sleep: {
      fatigueRecoveryPerMinute: 0.18,
      sanityRecoveryPerMinute: 0.03,
      comfortBonus: 1.5,
    },
    sanity: {
      fatigueWeight: 0.01,
      hungerWeight: 0.01,
      coldWeight: 0.02,
      comfortWarmth: 60,
    },
    thresholds: {
      cannotSleep: 25,
      freezing: 10,
      freezingDurationMinutes: 120,
    },
  },

  // ── Генератор ────────────────────────────────────────────────────────────
  generator: {
    heatingMax: 10,
    heatingStart: 4,
    fuelPerHeatingPerMinute: 0.02,
    fuelPerDeficitPerMinute: 0.001,
    comfortTemperature: -5,
    heatPerHeating: 0.03,
    heatPerDeficit: 0.004,
  },

  // ── Приём сигнала ────────────────────────────────────────────────────────
  reception: {
    windowWidth: 3,
    attemptMinutes: 10,
    tunerStart: 150,
  },

  // ── Проверка сигнала ─────────────────────────────────────────────────────
  signalCheck: {
    minutes: 20,
    fuel: 6,
  },

  // ── Терминал ─────────────────────────────────────────────────────────────
  terminal: {
    fixedMinutes: 10,
    minutesPerChar: 0.02,
    fixedFuel: 4,
    fuelPerChar: 0.01,
    disclaimer:
      "Текст рапорта уходит в две стороны. Первое: во внешний сервис разбора речи " +
      "(Gemini), чтобы город понял, о чём ты доложил. Второе: если ты напишешь что-то " +
      "не про службу, этот фрагмент попадёт в общую Базу аномалий и после ручной " +
      "модерации может быть услышан другими радистами как голос в эфире. " +
      "Отправляя рапорт, ты соглашаешься с обоими.",
  },

  // ── Приём пищи ───────────────────────────────────────────────────────────
  meal: {
    minutes: 15,
    hungerReduction: 35,
  },

  // ── Мостик ───────────────────────────────────────────────────────────────
  bridge: {
    stayMinutes: 15,
    sanityRestore: 4,
    baseCold: 3,
    safeMinutes: 45,
    coldEscalation: 1.6,
    destructionTiers: [
      { upTo: 20, label: "город стоит, огни в окнах" },
      { upTo: 45, label: "над кварталами дым" },
      { upTo: 70, label: "часть кварталов погасла, зарево у стены" },
      { upTo: 90, label: "стена проломлена, колонны у ворот" },
      { upTo: 100, label: "город чёрный, движения нет" },
    ],
    supplyHour: 12,
    supplyPeriodDays: 1,
    fuelShare: 0.7,
    rationVolume: 10,
  },

  // ── Сон ──────────────────────────────────────────────────────────────────
  sleep: {
    maxHours: 12,
  },

  // ── Галлюцинации ─────────────────────────────────────────────────────────
  hallucinations: {
    criticalSanity: 35,
    tickMinutes: 20,
    phantomBaseChance: 0.15,
    voiceBaseChance: 0.15,
    escalationCoef: 2,
    voiceFormat: "текст",
  },

  // ── Газета ───────────────────────────────────────────────────────────────
  newspaper: {
    hour: 7,
    watchTimerChance: 0.5,
    watchTimerFlavor: [
      "Эвакуацию снова перенесли. Ждите распоряжений.",
      "Колонна на юг не вышла: погода. Новую дату сообщат.",
      "Списки на вывоз уточняются. Вахту не покидать.",
      "Штаб подтверждает: вас помнят.",
    ],
    verdictTemplates: {
      правда: "Твой доклад о «{событие}» в квадрате {квадрант} подтвердился.",
      ложь: "Твой доклад о «{событие}» опровергнут.",
      неточность: "Твой доклад о «{событие}» признан неточным.",
      "правда_без_факта": "Неподтверждённое заявление, категория: правда.",
      "ложь_без_факта": "Неподтверждённое заявление, категория: ложь.",
      "неточность_без_факта": "Неподтверждённое заявление, категория: неточность.",
    },
    eventTemplates: {
      конвой_вышел: "Из квадрата {квадрант} вышел конвой.",
      конвой_прибыл: "Конвой из квадрата {квадрант} дошёл до города.",
      конвой_перехвачен: "Конвой перехвачен в квадрате {квадрант}.",
      конвой_погиб_в_шторме: "Конвой погиб в шторме в квадрате {квадрант}.",
      конвой_в_пути: "Конвой отмечен в квадрате {квадрант}.",
      атака: "Зафиксирована атака в квадрате {квадрант}.",
      атака_отбита: "Атака на город отбита.",
      атака_пробила_оборону: "Оборона города пробита. Потери среди населения.",
      атака_в_пустоту: "Удар пришёлся в пустой квадрат {квадрант}.",
      структура_уничтожена: "Объект в квадрате {квадрант} уничтожен.",
      шторм_ударил_по_городу: "Шторм прошёл над городом, есть разрушения.",
      бунт: "В городе беспорядки, поставки сорваны.",
      ремонт: "Ремонтные бригады закрыли часть повреждений.",
      спокойный_период: "Сутки прошли без происшествий.",
      хорошие_новости: "Из штаба пришли хорошие новости.",
      рост_тревоги: "Тревожные настроения в городе усилились.",
      дезинформация: "По эфиру идёт заведомо ложная сводка из квадрата {квадрант}.",
      город_мёртв: "Город замолчал.",
      военная_сводка: "Военная сводка из квадрата {квадрант}.",
      перегруппировка: "Гарнизон в квадрате {квадрант} перегруппирован.",
      болтовня: "Пост в квадрате {квадрант} выходил на связь.",
      сплетни: "С поста в квадрате {квадрант} идут слухи.",
      просьба_о_помощи: "Пост в квадрате {квадрант} просит помощи.",
      инвентаризация: "Склад в квадрате {квадрант} пересчитал запасы.",
      сигнал_бедствия: "В квадрате {квадрант} принят сигнал бедствия.",
      перехват_переговоров: "В квадрате {квадрант} перехвачены переговоры.",
      перехват_приписан_мародёрам: "Мародёры приписывают себе перехват в квадрате {квадрант}.",
      требование_выкупа: "Из квадрата {квадрант} пришло требование выкупа.",
      координаты_квадрата: "Свои передали координаты по квадрату {квадрант}.",
      шифровка: "Шифровка из квадрата {квадрант}.",
      оборона_периметра: "Доклад об обороне периметра, квадрат {квадрант}.",
    },
    farewellIssue:
      "ПОСЛЕДНИЙ ВЫПУСК. Город больше не отвечает. Типография остановлена. " +
      "Тому, кто это читает: вахта не снята.",
  },

  // ── Финал ────────────────────────────────────────────────────────────────
  ending: {
    tickMinutes: 60,
    routes: {
      "вахта_окончена:заморозка":
        "Вахта окончена. Ты замёрз на своём посту. Город горит огнями и не заметит.",
      "вахта_окончена:рассудок":
        "Вахта окончена. Ты перестал отличать эфир от себя. Город горит огнями и не заметит.",
      "последний_в_эфире:заморозка":
        "Последний в эфире. Города больше нет, снабжения не было, и холод закончил остальное.",
      "последний_в_эфире:рассудок":
        "Последний в эфире. Города больше нет. В пустом эфире остались только голоса, и ты ушёл к ним.",
    },
  },

  // ── Фильтр аномалий ──────────────────────────────────────────────────────
  anomalyFilter: {
    endpointWrite: "/api/anomaly",
    endpointRead: "/api/anomaly",
    rateLimitPerIp: 6,
    seedMessages: [],
  },

  // ── Прокси к Gemini ──────────────────────────────────────────────────────
  proxy: {
    endpoint: "/api/parse",
    timeoutSeconds: 8,
    rateLimitPerIp: 10,
    model: "gemini-2.0-flash",
    emptyParse: {
      claims: [],
      tone: { inspiration: 0.5, anxiety: 0.5, specificity: 0.5 },
      offtopic: { flag: false, text: "" },
    },
    systemPrompt:
      "Ты — разметчик текста, а не участник игры. На вход приходит рапорт радиста " +
      "и справочник имён (живые объекты с квадрантами, типы фракций, формат сетки). " +
      "Твоя задача — только извлечь утверждения, оценить тон и отметить офтопик. " +
      "Ты не оцениваешь истинность, не считаешь никаких чисел и не меняешь состояние игры. " +
      "Отвечай строго одним JSON-объектом по схеме: " +
      '{"claims":[{"id":str,"subject":str,"action":str,"place":str,"time":str,"confidence":number}],' +
      '"tone":{"inspiration":number,"anxiety":number,"specificity":number},' +
      '"offtopic":{"flag":bool,"text":str}}. ' +
      "Поле place — квадрант формата буква+цифра или пустая строка. " +
      "Поле confidence — 0..1, насколько уверенно автор утверждает. " +
      "Всё, что не относится к службе радиста, попадает в offtopic.",
    responseSchema: {
      type: "object",
      required: ["claims", "tone", "offtopic"],
      properties: {
        claims: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "subject", "action", "place", "time", "confidence"],
            properties: {
              id: { type: "string" },
              subject: { type: "string" },
              action: { type: "string" },
              place: { type: "string" },
              time: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
        tone: {
          type: "object",
          required: ["inspiration", "anxiety", "specificity"],
          properties: {
            inspiration: { type: "number", minimum: 0, maximum: 1 },
            anxiety: { type: "number", minimum: 0, maximum: 1 },
            specificity: { type: "number", minimum: 0, maximum: 1 },
          },
        },
        offtopic: {
          type: "object",
          required: ["flag", "text"],
          properties: {
            flag: { type: "boolean" },
            text: { type: "string" },
          },
        },
      },
    },
    matching: {
      timeToleranceMinutes: 180,
      confidenceThreshold: 0.6,
    },
  },

  // ── Стенд симуляции ──────────────────────────────────────────────────────
  sim: {
    baseSeed: 20260817,
    runs: 100,
    partyLengthDays: 13,
    timeStepMinutes: 5,
    isolatedCityMode: false,
    includeBroadcast: true,
    deadEtherWindowMinutes: 60,
    syntheticAttacks: {
      chancePerTick: 0.05,
      powerRange: [10, 45],
      tickMinutes: 60,
    },
    syntheticReports: {
      enabled: false,
      everyMinutes: 720,
      truthShare: 0.7,
    },
    outputFormat: "console",
  },
};
