"use client";

import { useEventWorkspace } from "@/components/event-workspace";
import { PageError, PageLoading } from "@/components/page-state";
import { AdminApiError, getEventGreeting, saveEventGreeting } from "@/lib/admin-api";
import { formatDateTime } from "@/lib/format";
import { useNotice } from "@/lib/use-notice";
import {
  GREETING_PHRASE_LIMIT,
  GREETING_TEMPLATE_LIMIT,
  formatEventWhen,
  renderGreeting,
  unknownGreetingPlaceholders,
  type EventGreetingView,
  type GreetingPlaceholder
} from "@ticket-platform/contracts/admin-greetings";
import { ArrowLeft, Info, MessageCircle, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

/** Имя для предпросмотра. Настоящее подставится из формы заявки. */
const SAMPLE_NAME = "Анна";

/**
 * Приветствие по заявке с сайта: что аккаунт компании напишет человеку, записавшемуся на
 * это мероприятие.
 *
 * Предпросмотр собирается здесь же, той же функцией, что у воркера, — поэтому показывает
 * ровно то, что уйдёт. Сервер при сохранении проверяет текст ещё раз: панель — удобство, а
 * не запрет.
 */
export default function EventGreetingPage() {
  const { event } = useEventWorkspace();
  const [view, setView] = useState<EventGreetingView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useNotice();

  const [isEnabled, setIsEnabled] = useState(true);
  const [phrase, setPhrase] = useState("");
  const [template, setTemplate] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  const apply = useCallback((next: EventGreetingView) => {
    setView(next);
    setIsEnabled(next.isEnabled);
    setPhrase(next.eventPhrase ?? "");
    setTemplate(next.bodyTemplate ?? next.defaultTemplate);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      apply(await getEventGreeting(event.id, signal));
    } catch (caught) {
      if (!signal?.aborted) {
        setLoadError(caught instanceof AdminApiError
          ? caught.message
          : "Не удалось загрузить приветствие.");
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [event.id, apply]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const facts = useMemo(() => view
    ? {
        title: view.event.title,
        phrase: phrase.trim() === "" ? null : phrase,
        startsAt: new Date(view.event.startsAt),
        timeZone: view.event.timeZone,
        locationName: view.event.locationName,
        locationAddress: view.event.locationAddress
      }
    : null, [view, phrase]);

  if (loading && !view) {
    return <PageLoading label="Открываем приветствие" />;
  }
  if (loadError && !view) {
    return <PageError message={loadError} retry={() => void load()} />;
  }
  if (!view || !facts) {
    return <PageError message="Приветствие недоступно." retry={() => void load()} />;
  }

  const readOnly = !view.canEdit;
  const unknown = unknownGreetingPlaceholders(template);
  const rendered = renderGreeting(template, { name: SAMPLE_NAME, event: facts });
  const isDefault = template.trim() === view.defaultTemplate;
  const dirty = isEnabled !== view.isEnabled
    || phrase.trim() !== (view.eventPhrase ?? "")
    || template.trim() !== (view.bodyTemplate ?? view.defaultTemplate);
  const place = [facts.locationName, facts.locationAddress]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(", ");

  const placeholders: readonly {
    readonly name: GreetingPlaceholder;
    readonly becomes: string;
  }[] = [
    {
      name: "мероприятии",
      becomes: facts.phrase ?? `мероприятии «${facts.title}»`
    },
    {
      name: "когда",
      becomes: formatEventWhen(facts.startsAt, facts.timeZone) ?? "часовой пояс не распознан"
    },
    {
      name: "где",
      becomes: place === ""
        ? "место не указано — уберётся вместе с запятой перед ним"
        : place
    },
    { name: "имя", becomes: `имя из формы, например «${SAMPLE_NAME}»` }
  ];

  function insert(name: GreetingPlaceholder) {
    const field = textarea.current;
    const token = `{${name}}`;
    if (!field) {
      setTemplate((value) => value + token);
      return;
    }
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const next = template.slice(0, start) + token + template.slice(end);
    setTemplate(next);
    // Курсор — сразу за вставленным, как после обычного набора.
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      apply(await saveEventGreeting(event.id, {
        isEnabled,
        eventPhrase: phrase.trim() === "" ? null : phrase,
        bodyTemplate: isDefault ? null : template
      }));
      setNotice("Приветствие сохранено. Следующие заявки получат этот текст.");
    } catch (caught) {
      setSaveError(caught instanceof AdminApiError
        ? caught.message
        : "Не удалось сохранить приветствие.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Link className="back-link" href={`/events/${event.id}/settings`}>
        <ArrowLeft size={17} />
        Настройки
      </Link>

      <div className="page-heading">
        <div>
          <p className="eyebrow">Приветствие</p>
          <h1>Что пишем записавшимся с сайта</h1>
          <p>
            Аккаунт компании пишет человеку в первый мессенджер, где он нашёлся по номеру,
            с 9 до 21 по Москве. Правки действуют на следующие заявки — уже ушедшие
            сообщения остаются в переписке такими, какими ушли.
          </p>
        </div>
      </div>

      <div className="metrics-strip">
        <div>
          <span>Отправлено</span>
          <strong>{view.stats.queued}</strong>
        </div>
        <div>
          <span>Ждут ответа мессенджеров</span>
          <strong>{view.stats.pending}</strong>
        </div>
        <div>
          <span>Ни в одном не нашли</span>
          <strong>{view.stats.noChannel}</strong>
        </div>
        <div>
          <span>Не писали</span>
          <strong>{view.stats.skipped}</strong>
          <small>менеджер успел сам, заявка старая и т. п.</small>
        </div>
      </div>

      {readOnly ? (
        <div className="accommodation-note">
          <Info size={16} />
          <span>Править приветствие может тот, у кого есть право на мероприятия.</span>
        </div>
      ) : null}

      {notice ? <div className="outreach-notice">{notice}</div> : null}

      <form className="event-form greeting-layout" onSubmit={(formEvent) => void submit(formEvent)}>
        <section className="event-form-section">
          <div className="section-title-row">
            <div>
              <h2>Настройки</h2>
              <span>
                {view.updatedAt === null
                  ? "Не меняли — действует общий текст"
                  : `Изменено ${formatDateTime(view.updatedAt)}${
                      view.updatedByName ? ` · ${view.updatedByName}` : ""
                    }`}
              </span>
            </div>
          </div>
          <div className="event-form-grid">
            <label className="check-field field-full">
              <input
                type="checkbox"
                checked={isEnabled}
                disabled={readOnly}
                onChange={(input) => setIsEnabled(input.target.checked)}
              />
              <span>
                Писать по заявкам на это мероприятие
                <small>
                  Выключите, если первым пишет бот продажи или человеку позвонят сами.
                  Задача на звонок по заявке ставится в любом случае.
                </small>
              </span>
            </label>

            <label className="field field-full">
              <span>Как назвать мероприятие в тексте</span>
              <input
                value={phrase}
                maxLength={GREETING_PHRASE_LIMIT}
                disabled={readOnly}
                placeholder={`мероприятии «${facts.title}»`}
                onChange={(input) => setPhrase(input.target.value)}
              />
              <small className="field-hint">
                В предложном падеже — продолжение фразы «на участие в …». Например,
                «Открытой встрече предпринимателей». Пусто — название в кавычках.
              </small>
            </label>

            <label className="field field-full">
              <span>Текст сообщения</span>
              <textarea
                ref={textarea}
                value={template}
                rows={11}
                maxLength={GREETING_TEMPLATE_LIMIT}
                disabled={readOnly}
                aria-invalid={unknown.length > 0}
                onChange={(input) => setTemplate(input.target.value)}
              />
              {unknown.length > 0 ? (
                <small className="form-error">
                  Неизвестная подстановка: {unknown.map((name) => `{${name}}`).join(", ")}.
                  Такое приветствие не уйдёт — поправьте или уберите её.
                </small>
              ) : (
                <small className="field-hint">
                  {isDefault
                    ? "Общий текст. Поправите — у этого мероприятия будет свой."
                    : "Свой текст этого мероприятия."}
                </small>
              )}
            </label>

            <div className="field field-full">
              <span>Подстановки — нажмите, чтобы вставить в текст</span>
              <ul className="greeting-placeholders">
                {placeholders.map((item) => (
                  <li key={item.name}>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={readOnly}
                      onClick={() => insert(item.name)}
                    >
                      {`{${item.name}}`}
                    </button>
                    <span>{item.becomes}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="event-form-section greeting-preview-section">
          <div className="section-title-row">
            <div>
              <h2>Так увидит человек</h2>
              <span>Имя для примера — {SAMPLE_NAME}</span>
            </div>
          </div>
          <div className="greeting-preview-body">
            {!isEnabled ? (
              <p className="field-hint">Приветствие выключено — по заявкам не пишем.</p>
            ) : null}
            {rendered.kind === "ok" ? (
              <div className="greeting-bubble">
                <MessageCircle size={15} aria-hidden="true" />
                <p>{rendered.body}</p>
              </div>
            ) : (
              <p className="form-error">{rendered.reason}</p>
            )}
          </div>
        </section>

        {saveError ? <p className="form-error event-form-error">{saveError}</p> : null}
        {readOnly ? null : (
          <div className="event-form-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={saving || isDefault}
              onClick={() => setTemplate(view.defaultTemplate)}
            >
              <RotateCcw size={16} />
              Вернуть общий текст
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={saving || !dirty || unknown.length > 0 || template.trim() === ""}
            >
              <Save size={16} />
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        )}
      </form>
    </>
  );
}
