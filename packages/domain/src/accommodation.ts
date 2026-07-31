/**
 * Расселение гостей по палаткам.
 *
 * Считаем не по головам, а по компаниям: заказ — это люди, которые едут вместе и готовы
 * спать в одной палатке. Незнакомых между собой не подселяем автоматически, поэтому
 * одиночная компания получает свою палатку и попадает в список «спросить о подселении» —
 * решение остаётся за человеком. Ребёнок занимает полноценное место.
 */

export interface AccommodationParty {
  /** Устойчивый ключ: id заказа либо id объединённой вручную группы. */
  readonly key: string;
  /** Сколько спальных мест нужно компании. Ребёнок считается за место. */
  readonly berths: number;
  readonly title: string;
  readonly orderNumbers: readonly string[];
  /** Компания собрана вручную из нескольких заказов пометкой «селить вместе». */
  readonly merged: boolean;
}

export interface TentAllocation {
  readonly party: AccommodationParty;
  /** Вместимости выданных палаток, от большей к меньшей. */
  readonly tents: readonly number[];
  readonly emptyBerths: number;
}

export interface TentCount {
  readonly capacity: number;
  readonly count: number;
}

export interface MergeSuggestion {
  /** Сколько одиночных компаний можно объединить. */
  readonly singleParties: number;
  /** Сколько палаток они занимают сейчас, каждая своя. */
  readonly tentsNow: number;
  /** Сколько заняли бы, если бы все согласились на подселение. */
  readonly tentsIfMerged: number;
}

export interface TentPlan {
  readonly allocations: readonly TentAllocation[];
  readonly tents: readonly TentCount[];
  readonly totalTents: number;
  readonly requiredBerths: number;
  readonly plannedBerths: number;
  readonly emptyBerths: number;
  /** Компании из одного человека — по ним нужно решение о подселении. */
  readonly singles: readonly AccommodationParty[];
  readonly mergeSuggestion: MergeSuggestion | null;
}

interface PackingOption {
  readonly tents: readonly number[];
  readonly emptyBerths: number;
}

/**
 * Раскладывает компании по палаткам доступных размеров.
 *
 * `capacities` — вместимости палаток, которые у нас есть (например, 2 и 3). Порядок и
 * повторы значения не имеют. Появятся четырёхместные — достаточно передать новое число,
 * алгоритм менять не нужно.
 */
export function planTents(
  parties: readonly AccommodationParty[],
  capacities: readonly number[]
): TentPlan {
  const usableCapacities = normalizeCapacities(capacities);
  const allocations = parties.map((party) => allocateParty(party, usableCapacities));

  const tentTotals = new Map<number, number>();
  let requiredBerths = 0;
  let plannedBerths = 0;
  let emptyBerths = 0;

  for (const allocation of allocations) {
    requiredBerths += allocation.party.berths;
    emptyBerths += allocation.emptyBerths;
    for (const capacity of allocation.tents) {
      plannedBerths += capacity;
      tentTotals.set(capacity, (tentTotals.get(capacity) ?? 0) + 1);
    }
  }

  const tents = [...tentTotals.entries()]
    .map(([capacity, count]) => ({ capacity, count }))
    .sort((left, right) => right.capacity - left.capacity);

  const singles = allocations
    .filter((allocation) => allocation.party.berths === 1)
    .map((allocation) => allocation.party);

  return {
    allocations,
    tents,
    totalTents: tents.reduce((sum, tent) => sum + tent.count, 0),
    requiredBerths,
    plannedBerths,
    emptyBerths,
    singles,
    mergeSuggestion: buildMergeSuggestion(singles, usableCapacities)
  };
}

function allocateParty(
  party: AccommodationParty,
  capacities: readonly number[]
): TentAllocation {
  if (!Number.isSafeInteger(party.berths) || party.berths < 0) {
    throw new Error("Party berths must be a non-negative integer");
  }
  if (party.berths === 0) {
    return { party, tents: [], emptyBerths: 0 };
  }

  const packing = packBerths(party.berths, capacities);
  return {
    party,
    tents: [...packing.tents].sort((left, right) => right - left),
    emptyBerths: packing.emptyBerths
  };
}

/**
 * Подбирает набор палаток под нужное число мест.
 *
 * Жадный выбор «сначала самые большие» здесь ошибается: на четверых он выдаёт 3+2 с одним
 * пустым местом вместо 2+2. Поэтому перебираем динамикой по числу мест: сначала минимизируем
 * пустые места, при равенстве — число палаток.
 */
function packBerths(berths: number, capacities: readonly number[]): PackingOption {
  const best: PackingOption[] = [{ tents: [], emptyBerths: 0 }];

  for (let need = 1; need <= berths; need += 1) {
    let chosen: PackingOption | null = null;

    for (const capacity of capacities) {
      const previous = best[Math.max(0, need - capacity)];
      if (!previous) {
        continue;
      }
      const candidate: PackingOption = {
        tents: [...previous.tents, capacity],
        emptyBerths: previous.emptyBerths + Math.max(0, capacity - need)
      };
      if (chosen === null || isBetterPacking(candidate, chosen)) {
        chosen = candidate;
      }
    }

    if (chosen === null) {
      throw new Error("No tent capacity is available for accommodation planning");
    }
    best[need] = chosen;
  }

  const result = best[berths];
  if (!result) {
    throw new Error("No tent capacity is available for accommodation planning");
  }
  return result;
}

function isBetterPacking(candidate: PackingOption, current: PackingOption): boolean {
  return candidate.emptyBerths !== current.emptyBerths
    ? candidate.emptyBerths < current.emptyBerths
    : candidate.tents.length < current.tents.length;
}

/**
 * Во сколько палаток уложились бы одиночки, если бы все согласились на подселение.
 * Это подсказка для разговора с гостями, а не готовое решение — само по себе объединение
 * не происходит.
 */
function buildMergeSuggestion(
  singles: readonly AccommodationParty[],
  capacities: readonly number[]
): MergeSuggestion | null {
  if (singles.length < 2) {
    return null;
  }

  const merged = packBerths(singles.length, capacities);
  if (merged.tents.length >= singles.length) {
    return null;
  }

  return {
    singleParties: singles.length,
    tentsNow: singles.length,
    tentsIfMerged: merged.tents.length
  };
}

function normalizeCapacities(capacities: readonly number[]): readonly number[] {
  const usable = [...new Set(capacities)]
    .filter((capacity) => Number.isSafeInteger(capacity) && capacity > 0)
    .sort((left, right) => right - left);

  if (usable.length === 0) {
    throw new Error("At least one tent capacity is required");
  }
  return usable;
}
