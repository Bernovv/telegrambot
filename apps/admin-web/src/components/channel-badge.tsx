import type { MessengerChannel, OrderChannel } from "@ticket-platform/contracts";

/**
 * Плашка канала: где человек с нами разговаривает и где оформлен заказ.
 *
 * Пока канал был один, показывать его было незачем. С появлением MAX это первое, что нужно
 * знать перед действием: в каком мессенджере писать человеку и куда ушёл его билет. Поэтому
 * плашка одинаковая везде — в списке людей, в списке заказов и в карточке.
 *
 * Цветом каналы не различаются намеренно. Цвет в панели значит состояние — оплачено,
 * просрочено, заблокирован, — и раскрасить им признак «откуда» значит сказать, что один
 * мессенджер лучше другого.
 */
const LABELS: Record<OrderChannel, string> = {
  telegram: "Telegram",
  max: "MAX",
  admin: "Панель",
  web: "Сайт"
};

export function ChannelBadge({ channel }: { readonly channel: OrderChannel }) {
  return (
    <span className="channel-badge" title={`Канал: ${LABELS[channel]}`}>
      {LABELS[channel]}
    </span>
  );
}

/**
 * Каналы человека.
 *
 * Их может быть два: один и тот же человек открывает и Telegram, и MAX. Пусто — не открывал
 * ни одного, и это не пробел в данных, а факт: так выглядят те, кого завели импортом или
 * руками, и написать им в мессенджер нельзя.
 */
export function ChannelBadges({
  channels
}: {
  readonly channels: readonly MessengerChannel[];
}) {
  if (channels.length === 0) {
    return <span className="muted">—</span>;
  }
  return (
    <span className="channel-badges">
      {channels.map((channel) => (
        <ChannelBadge key={channel} channel={channel} />
      ))}
    </span>
  );
}
