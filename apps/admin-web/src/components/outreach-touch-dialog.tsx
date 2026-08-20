"use client";

import {
  AdminApiError,
  listOutreachPipelineColumns,
  recordOutreachActivities
} from "@/lib/admin-api";
import {
  LOST_REASONS,
  channelLabel,
  lostReasonLabel,
  statusLabel
} from "@/lib/outreach-labels";
import {
  OUTREACH_CHANNELS,
  type OutreachChannel,
  type OutreachContactStatus,
  type OutreachLostReason,
  type OutreachPipelineColumn,
  type OutreachPipelineColumnOutcome,
  type OutreachPipelineStage
} from "@ticket-platform/contracts/admin-outreach";
import { X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

/**
 * Контакт кампании, с которым связываются. Признаки нужны, чтобы предложить подходящий
 * канал и честно сказать, скольким из выбранных выбранным каналом писать нечем.
 */
export interface OutreachTouchTarget {
  readonly campaignContactId: string;
  readonly displayName: string | null;
  readonly phone: string | null;
  readonly telegramUsername: string | null;
  readonly maxIdentifier: string | null;
  /** «Свой»: звонить не надо. Диалог не запрещает, но говорит об этом до записи касания. */
  readonly isOwn: boolean;
}

/**
 * Запись касания — одна на всю панель.
 *
 * Раньше «отметить звонок» и «отметить сообщение» были двумя кнопками, хотя различались
 * ровно одним полем формы. Теперь действие одно — «Связаться», — а канал уточняется здесь.
 */
export function OutreachTouchDialog({
  campaignId,
  targets,
  columns,
  onClose,
  onRecorded
}: {
  readonly campaignId: string;
  readonly targets: readonly OutreachTouchTarget[];
  /** Уже загруженные колонки воронки. null — диалог возьмёт их сам. */
  readonly columns: readonly OutreachPipelineColumn[] | null;
  readonly onClose: () => void;
  readonly onRecorded: (recorded: number) => void | Promise<void>;
}) {
  const [pipeline, setPipeline] =
    useState<readonly OutreachPipelineColumn[]>(columns ?? []);
  const [channel, setChannel] =
    useState<OutreachChannel>(() => defaultChannelFor(targets));
  const [result, setResult] =
    useState<Exclude<OutreachContactStatus, "new">>(() =>
      defaultChannelFor(targets) === "phone" ? "no_answer" : "sent");
  const [stage, setStage] = useState<OutreachPipelineStage>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Колонки нужны, чтобы предложить, куда сдвинуть карточку. На доске задач кампания у
  // каждой задачи своя, поэтому список подгружается по требованию, а не приходит сверху.
  useEffect(() => {
    if (columns !== null) {
      setPipeline(columns);
      return;
    }
    const controller = new AbortController();
    void listOutreachPipelineColumns(campaignId, controller.signal)
      .then(setPipeline)
      .catch(() => setPipeline([]));
    return () => controller.abort();
  }, [campaignId, columns]);

  // Этап предлагается по результату: «заинтересован» двигает вперёд, «отказ» закрывает.
  // Пересчитывается и когда колонки только что доехали, и когда менеджер сменил результат.
  useEffect(() => {
    setStage(suggestStage(result, pipeline));
  }, [result, pipeline]);

  const unreachable = targets.filter(
    (target) => !hasIdentifierFor(target, channel)
  );
  const own = targets.filter((target) => target.isOwn);
  const outcome = outcomeOf(stage, pipeline);

  function switchChannel(next: OutreachChannel) {
    setChannel(next);
    setResult(next === "phone" ? "no_answer" : "sent");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const note = text(data, "note").trim();
    const nextContactAt = text(data, "nextContactAt");
    const lostReason = text(data, "lostReason") as OutreachLostReason | "";
    setSubmitting(true);
    setError(null);
    try {
      const response = await recordOutreachActivities({
        campaignContactIds: targets.map((target) => target.campaignContactId),
        channel,
        result,
        ...(stage ? { stage } : {}),
        ...(outcome === "lost" && lostReason ? { lostReason } : {}),
        ...(note ? { note } : {}),
        ...(nextContactAt
          ? { nextContactAt: new Date(nextContactAt).toISOString() }
          : {})
      });
      await onRecorded(response.recorded);
    } catch (caught) {
      setError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось записать касание.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="outreach-modal-backdrop" role="presentation">
      <section
        className="outreach-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="touch-title"
      >
        <div className="section-title-row">
          <div>
            <h2 id="touch-title">Связаться</h2>
            <span>
              {targets.length === 1
                ? "Отметьте, как связались и что получилось"
                : `Контактов: ${targets.length}`}
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Записать звонок человеку без телефона иногда и надо — номер мог быть у менеджера
            на бумаге. Но молча делать вид, что связь была, нечестно. */}
        {unreachable.length > 0 ? (
          <div className="page-warning">
            {unreachable.length === targets.length
              ? `Ни у кого из выбранных нет признака для канала «${channelLabel(channel)}».`
              : `Без признака для канала «${channelLabel(channel)}»: ${unreachable.length} из ${targets.length}.`}
          </div>
        ) : null}
        {/* Запретить нельзя: иногда своему как раз и звонят, по делу. Но узнать об этом
            менеджер должен до разговора, а не после. */}
        {own.length > 0 ? (
          <div className="page-warning">
            <strong>Среди выбранных есть свои.</strong>{" "}
            {own.length === targets.length
              ? "Обзванивать их не надо."
              : `${own.length} из ${targets.length}: `}
            {own.length !== targets.length
              ? own.map((target) => target.displayName ?? "без имени").join(", ")
              : null}
          </div>
        ) : null}
        {error ? <div className="page-warning">{error}</div> : null}

        <form className="outreach-action-form" onSubmit={(event) => void submit(event)}>
          <label>
            <span>Как связались</span>
            <select
              value={channel}
              onChange={(event) =>
                switchChannel(event.target.value as OutreachChannel)}
            >
              {OUTREACH_CHANNELS.map((option) => (
                <option key={option} value={option}>{channelLabel(option)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Результат касания</span>
            <select
              required
              value={result}
              onChange={(event) =>
                setResult(event.target.value as Exclude<OutreachContactStatus, "new">)}
            >
              {resultsFor(channel).map((option) => (
                <option key={option} value={option}>{statusLabel(option)}</option>
              ))}
            </select>
          </label>
          {pipeline.length > 0 ? (
            <label>
              <span>Переместить в этап</span>
              <select
                value={stage}
                onChange={(event) => setStage(event.target.value)}
              >
                {pipeline.map((column) => (
                  <option key={column.stage} value={column.stage}>{column.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          {outcome === "lost" ? (
            <label>
              <span>Причина закрытия</span>
              <select name="lostReason" required defaultValue="declined">
                {LOST_REASONS.map((reason) => (
                  <option key={reason} value={reason}>{lostReasonLabel(reason)}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label>
            <span>
              {result === "callback" ? "Когда связаться" : "Следующая задача (необязательно)"}
            </span>
            <input
              name="nextContactAt"
              type="datetime-local"
              required={result === "callback"}
            />
          </label>
          <label>
            <span>Комментарий</span>
            <textarea name="note" rows={3} maxLength={2000} />
          </label>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? "Сохраняем…" : "Записать касание"}
          </button>
        </form>
      </section>
    </div>
  );
}

/**
 * Какой канал предложить первым. Звонок отвечает лучше всего и остаётся выбором по
 * умолчанию, но если телефона нет ни у кого, предлагать его — значит заставлять менеджера
 * переключать поле руками при каждом касании.
 */
export function defaultChannelFor(
  targets: readonly OutreachTouchTarget[]
): OutreachChannel {
  if (targets.length === 0 || targets.some((target) => target.phone)) {
    return "phone";
  }
  if (targets.some((target) => target.telegramUsername)) {
    return "telegram";
  }
  if (targets.some((target) => target.maxIdentifier)) {
    return "max";
  }
  return "phone";
}

/** Есть ли чем связаться этим каналом. «Другое» подходит всегда — на то оно и другое. */
function hasIdentifierFor(
  target: OutreachTouchTarget,
  channel: OutreachChannel
): boolean {
  if (channel === "phone" || channel === "sms" || channel === "whatsapp") {
    return target.phone !== null;
  }
  if (channel === "telegram") {
    return target.telegramUsername !== null;
  }
  if (channel === "max") {
    return target.maxIdentifier !== null;
  }
  return true;
}

function resultsFor(
  channel: OutreachChannel
): readonly Exclude<OutreachContactStatus, "new">[] {
  return channel === "phone"
    ? ["no_answer", "answered", "callback", "interested", "declined", "converted", "invalid"]
    : ["sent", "answered", "callback", "interested", "declined", "converted", "invalid"];
}

/**
 * Куда предложить сдвинуть карточку по результату касания. Догадка работает для стартовых
 * стадий и для отмеченных как «оплатил»/«закрыто»; переименованные и добавленные менеджером
 * стадии она не угадывает — карточка просто остаётся там же, и её тянут руками.
 */
function suggestStage(
  result: Exclude<OutreachContactStatus, "new">,
  columns: readonly OutreachPipelineColumn[]
): OutreachPipelineStage {
  const byId = (stage: string) =>
    columns.find((column) => column.stage === stage)?.stage;
  const byOutcome = (outcome: OutreachPipelineColumnOutcome) =>
    columns.find((column) => column.outcome === outcome)?.stage;
  const suggestion: Partial<Record<typeof result, string | undefined>> = {
    sent: byId("first_contact"),
    no_answer: byId("first_contact"),
    answered: byId("dialogue"),
    callback: byId("follow_up"),
    interested: byId("interested"),
    declined: byOutcome("lost"),
    converted: byOutcome("won"),
    invalid: byOutcome("lost")
  };
  return suggestion[result] ?? columns[0]?.stage ?? "";
}

function outcomeOf(
  stage: OutreachPipelineStage,
  columns: readonly OutreachPipelineColumn[]
): OutreachPipelineColumnOutcome {
  return columns.find((column) => column.stage === stage)?.outcome ?? "open";
}

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}
