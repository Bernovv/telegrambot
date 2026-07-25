create table public.events (
  id uuid primary key,
  slug text not null unique,
  title text not null,
  description text not null default '',
  timezone text not null default 'Europe/Moscow',
  starts_at timestamptz not null,
  ends_at timestamptz,
  sales_starts_at timestamptz,
  sales_ends_at timestamptz,
  location_name text,
  location_address text,
  support_contact text,
  status text not null default 'draft',
  capacity integer not null,
  reservation_ttl_minutes integer not null default 30,
  phone_required_for_purchase boolean not null default true,
  offer_required boolean not null default true,
  published_scenario_version_id uuid,
  published_at timestamptz,
  lock_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_slug_check check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and length(slug) between 2 and 100
  ),
  constraint events_title_check check (length(btrim(title)) between 1 and 250),
  constraint events_timezone_check check (length(btrim(timezone)) between 1 and 100),
  constraint events_status_check check (
    status in ('draft', 'published', 'sales_paused', 'sold_out', 'finished', 'archived')
  ),
  constraint events_capacity_check check (capacity > 0),
  constraint events_reservation_ttl_check check (
    reservation_ttl_minutes between 1 and 1440
  ),
  constraint events_dates_check check (ends_at is null or ends_at > starts_at),
  constraint events_sales_window_check check (
    sales_ends_at is null
    or sales_starts_at is null
    or sales_ends_at > sales_starts_at
  ),
  constraint events_lock_version_check check (lock_version > 0),
  constraint events_published_at_check check (
    (status = 'draft' and published_at is null)
    or status <> 'draft'
  )
);

create index events_status_sales_window_idx
  on public.events (status, sales_starts_at, sales_ends_at);

create table public.event_content_blocks (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  block_type text not null,
  title text,
  content_schema_version smallint not null default 1,
  content jsonb not null,
  sort_order integer not null,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_content_blocks_type_check check (
    block_type in ('hero', 'description', 'program', 'faq', 'contacts', 'media', 'custom')
  ),
  constraint event_content_blocks_schema_check check (content_schema_version > 0),
  constraint event_content_blocks_content_check check (jsonb_typeof(content) = 'object'),
  constraint event_content_blocks_sort_order_check check (sort_order >= 0),
  unique (event_id, sort_order)
);

create table public.ticket_products (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  code text not null,
  product_type text not null,
  title text not null,
  description text not null default '',
  currency text not null default 'RUB',
  bundle_schema_version smallint not null default 1,
  bundle_composition jsonb not null default '[]'::jsonb,
  inventory_units_per_item integer not null default 1,
  capacity integer,
  maximum_quantity_per_order integer not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_products_code_check check (
    code = lower(code)
    and code ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
    and length(code) between 2 and 100
  ),
  constraint ticket_products_type_check check (
    product_type in (
      'adult_standard',
      'adult_vip',
      'child',
      'family_standard',
      'family_vip',
      'custom'
    )
  ),
  constraint ticket_products_title_check check (length(btrim(title)) between 1 and 250),
  constraint ticket_products_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint ticket_products_bundle_schema_check check (bundle_schema_version > 0),
  constraint ticket_products_bundle_check check (jsonb_typeof(bundle_composition) = 'array'),
  constraint ticket_products_inventory_units_check check (inventory_units_per_item > 0),
  constraint ticket_products_capacity_check check (capacity is null or capacity > 0),
  constraint ticket_products_maximum_quantity_check check (maximum_quantity_per_order > 0),
  constraint ticket_products_sort_order_check check (sort_order >= 0),
  unique (event_id, code)
);

create index ticket_products_event_active_idx
  on public.ticket_products (event_id, is_active, sort_order);

create table public.pricing_rules (
  id uuid primary key,
  product_id uuid not null references public.ticket_products(id),
  currency text not null,
  minimum_quantity integer not null,
  maximum_quantity integer,
  unit_price_kopecks bigint not null,
  priority integer not null default 0,
  specificity integer not null default 0,
  valid_from timestamptz,
  valid_until timestamptz,
  condition_schema_version smallint not null default 1,
  conditions jsonb not null default '{}'::jsonb,
  explanation text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_rules_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint pricing_rules_quantity_check check (
    minimum_quantity > 0
    and (maximum_quantity is null or maximum_quantity >= minimum_quantity)
  ),
  constraint pricing_rules_price_check check (unit_price_kopecks >= 0),
  constraint pricing_rules_specificity_check check (specificity >= 0),
  constraint pricing_rules_validity_check check (
    valid_until is null
    or valid_from is null
    or valid_until > valid_from
  ),
  constraint pricing_rules_condition_schema_check check (condition_schema_version > 0),
  constraint pricing_rules_conditions_check check (jsonb_typeof(conditions) = 'object'),
  constraint pricing_rules_explanation_check check (length(btrim(explanation)) > 0)
);

create index pricing_rules_product_lookup_idx
  on public.pricing_rules (
    product_id,
    is_active,
    priority desc,
    specificity desc,
    valid_from desc,
    id
  );

create table public.offer_documents (
  id uuid primary key,
  event_id uuid references public.events(id),
  title text not null,
  source_type text not null,
  source_url text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offer_documents_title_check check (length(btrim(title)) between 1 and 250),
  constraint offer_documents_source_type_check check (
    source_type in ('google_docs', 'upload', 'html')
  ),
  constraint offer_documents_status_check check (
    status in ('draft', 'published', 'archived')
  ),
  constraint offer_documents_source_url_check check (
    source_url is null or source_url ~ '^https://'
  )
);

create table public.offer_versions (
  id uuid primary key,
  offer_document_id uuid not null references public.offer_documents(id),
  version_number integer not null,
  public_url text not null,
  storage_path text not null,
  content_type text not null,
  sha256 text not null,
  published_at timestamptz not null,
  published_by_admin_id uuid references public.admin_accounts(id),
  is_active boolean not null default true,
  source_revision_id text,
  display_text_snapshot text not null,
  created_at timestamptz not null default now(),
  constraint offer_versions_number_check check (version_number > 0),
  constraint offer_versions_public_url_check check (public_url ~ '^https://'),
  constraint offer_versions_storage_path_check check (length(btrim(storage_path)) > 0),
  constraint offer_versions_content_type_check check (
    content_type in ('application/pdf', 'text/html')
  ),
  constraint offer_versions_sha256_check check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint offer_versions_display_text_check check (length(btrim(display_text_snapshot)) > 0),
  unique (offer_document_id, version_number)
);

create unique index offer_versions_one_active_per_document_idx
  on public.offer_versions (offer_document_id)
  where is_active;

alter table public.events
  add column active_offer_version_id uuid references public.offer_versions(id);

create table public.orders (
  id uuid primary key,
  number text not null unique,
  public_token_hash text not null unique,
  creation_idempotency_key text not null unique,
  creation_request_hash text not null,
  user_id uuid not null references public.users(id),
  event_id uuid not null references public.events(id),
  status text not null default 'draft',
  currency text not null,
  subtotal_kopecks bigint not null,
  discount_kopecks bigint not null default 0,
  total_kopecks bigint not null,
  wallet_applied_kopecks bigint not null default 0,
  external_due_kopecks bigint not null,
  tax_kopecks bigint not null default 0,
  snapshot_schema_version smallint not null default 1,
  event_snapshot jsonb not null,
  pricing_snapshot jsonb not null,
  offer_version_id uuid references public.offer_versions(id),
  offer_accepted_at timestamptz,
  expires_at timestamptz not null,
  paid_at timestamptz,
  source text not null,
  lock_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_number_check check (
    number ~ '^[A-Z0-9-]{6,40}$'
  ),
  constraint orders_public_token_hash_check check (
    public_token_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint orders_creation_idempotency_key_check check (
    length(creation_idempotency_key) between 8 and 200
  ),
  constraint orders_creation_request_hash_check check (
    creation_request_hash ~ '^[a-f0-9]{64}$'
  ),
  constraint orders_status_check check (
    status in (
      'draft',
      'awaiting_offer',
      'awaiting_payment',
      'payment_processing',
      'paid',
      'cancelled',
      'expired',
      'partially_refunded',
      'refunded'
    )
  ),
  constraint orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint orders_amounts_check check (
    subtotal_kopecks >= 0
    and discount_kopecks >= 0
    and total_kopecks >= 0
    and wallet_applied_kopecks >= 0
    and external_due_kopecks >= 0
    and tax_kopecks >= 0
    and discount_kopecks <= subtotal_kopecks
    and total_kopecks = subtotal_kopecks - discount_kopecks
    and wallet_applied_kopecks <= total_kopecks
    and external_due_kopecks = total_kopecks - wallet_applied_kopecks
    and tax_kopecks <= total_kopecks
  ),
  constraint orders_snapshot_schema_check check (snapshot_schema_version > 0),
  constraint orders_event_snapshot_check check (jsonb_typeof(event_snapshot) = 'object'),
  constraint orders_pricing_snapshot_check check (jsonb_typeof(pricing_snapshot) = 'object'),
  constraint orders_offer_acceptance_check check (
    offer_accepted_at is null or offer_version_id is not null
  ),
  constraint orders_expiry_check check (expires_at > created_at),
  constraint orders_paid_at_check check (
    (status in ('paid', 'partially_refunded', 'refunded') and paid_at is not null)
    or (status not in ('paid', 'partially_refunded', 'refunded') and paid_at is null)
  ),
  constraint orders_lock_version_check check (lock_version > 0)
);

create index orders_user_created_idx
  on public.orders (user_id, created_at desc);

create index orders_event_status_created_idx
  on public.orders (event_id, status, created_at desc);

create index orders_expiry_idx
  on public.orders (expires_at)
  where status in ('draft', 'awaiting_offer', 'awaiting_payment', 'payment_processing');

create table public.order_items (
  id uuid primary key,
  order_id uuid not null references public.orders(id),
  product_id uuid not null references public.ticket_products(id),
  product_snapshot_schema_version smallint not null default 1,
  product_snapshot jsonb not null,
  quantity integer not null,
  inventory_units integer not null,
  unit_price_kopecks bigint not null,
  line_total_kopecks bigint not null,
  discount_kopecks bigint not null default 0,
  tax_kopecks bigint not null default 0,
  pricing_rule_id uuid not null references public.pricing_rules(id),
  pricing_snapshot jsonb not null,
  metadata_schema_version smallint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_items_product_snapshot_schema_check check (
    product_snapshot_schema_version > 0
  ),
  constraint order_items_product_snapshot_check check (
    jsonb_typeof(product_snapshot) = 'object'
  ),
  constraint order_items_quantity_check check (quantity > 0),
  constraint order_items_inventory_units_check check (inventory_units > 0),
  constraint order_items_amounts_check check (
    unit_price_kopecks >= 0
    and line_total_kopecks = unit_price_kopecks * quantity
    and discount_kopecks >= 0
    and discount_kopecks <= line_total_kopecks
    and tax_kopecks >= 0
    and tax_kopecks <= line_total_kopecks - discount_kopecks
  ),
  constraint order_items_pricing_snapshot_check check (
    jsonb_typeof(pricing_snapshot) = 'object'
  ),
  constraint order_items_metadata_schema_check check (metadata_schema_version > 0),
  constraint order_items_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index order_items_order_idx on public.order_items (order_id, created_at);

create table public.order_status_history (
  id uuid primary key,
  order_id uuid not null references public.orders(id),
  from_status text,
  to_status text not null,
  reason text not null,
  actor_type text not null,
  actor_user_id uuid references public.users(id),
  actor_admin_id uuid references public.admin_accounts(id),
  idempotency_key text not null unique,
  occurred_at timestamptz not null,
  metadata_schema_version smallint not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  constraint order_status_history_from_check check (
    from_status is null
    or from_status in (
      'draft',
      'awaiting_offer',
      'awaiting_payment',
      'payment_processing',
      'paid',
      'cancelled',
      'expired',
      'partially_refunded',
      'refunded'
    )
  ),
  constraint order_status_history_to_check check (
    to_status in (
      'draft',
      'awaiting_offer',
      'awaiting_payment',
      'payment_processing',
      'paid',
      'cancelled',
      'expired',
      'partially_refunded',
      'refunded'
    )
  ),
  constraint order_status_history_reason_check check (length(btrim(reason)) > 0),
  constraint order_status_history_actor_type_check check (
    actor_type in ('user', 'admin', 'system', 'payment_provider')
  ),
  constraint order_status_history_actor_check check (
    (actor_type = 'user' and actor_user_id is not null and actor_admin_id is null)
    or (actor_type = 'admin' and actor_admin_id is not null and actor_user_id is null)
    or (actor_type in ('system', 'payment_provider') and actor_user_id is null and actor_admin_id is null)
  ),
  constraint order_status_history_metadata_schema_check check (
    metadata_schema_version > 0
  ),
  constraint order_status_history_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index order_status_history_order_idx
  on public.order_status_history (order_id, occurred_at);

create table public.offer_acceptances (
  id uuid primary key,
  user_id uuid not null references public.users(id),
  order_id uuid not null references public.orders(id),
  offer_version_id uuid not null references public.offer_versions(id),
  accepted_at timestamptz not null,
  channel text not null,
  messenger_identity_id uuid references public.messenger_identities(id),
  telegram_update_id text,
  telegram_message_id text,
  callback_query_id text,
  acceptance_text_snapshot text not null,
  ip_address inet,
  user_agent text,
  evidence_schema_version smallint not null default 1,
  evidence jsonb not null default '{}'::jsonb,
  constraint offer_acceptances_channel_check check (
    channel in ('telegram', 'admin', 'web')
  ),
  constraint offer_acceptances_text_check check (
    length(btrim(acceptance_text_snapshot)) > 0
  ),
  constraint offer_acceptances_evidence_schema_check check (
    evidence_schema_version > 0
  ),
  constraint offer_acceptances_evidence_check check (jsonb_typeof(evidence) = 'object'),
  unique (order_id, offer_version_id)
);

create unique index offer_acceptances_callback_query_idx
  on public.offer_acceptances (callback_query_id)
  where callback_query_id is not null;

create table public.inventory_reservations (
  id uuid primary key,
  event_id uuid not null references public.events(id),
  product_id uuid not null references public.ticket_products(id),
  order_id uuid not null references public.orders(id),
  order_item_id uuid not null references public.order_items(id),
  inventory_units integer not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_reservations_units_check check (inventory_units > 0),
  constraint inventory_reservations_status_check check (
    status in ('active', 'consumed', 'released', 'expired')
  ),
  constraint inventory_reservations_lifecycle_check check (
    (status = 'active' and consumed_at is null and released_at is null)
    or (status = 'consumed' and consumed_at is not null and released_at is null)
    or (status in ('released', 'expired') and released_at is not null and consumed_at is null)
  ),
  constraint inventory_reservations_expiry_check check (expires_at > created_at),
  unique (order_item_id)
);

create index inventory_reservations_event_active_idx
  on public.inventory_reservations (event_id, expires_at)
  where status = 'active';

create index inventory_reservations_product_active_idx
  on public.inventory_reservations (product_id, expires_at)
  where status = 'active';

create table public.tickets (
  id uuid primary key,
  ticket_number text not null unique,
  event_id uuid not null references public.events(id),
  order_id uuid not null references public.orders(id),
  order_item_id uuid not null references public.order_items(id),
  owner_user_id uuid not null references public.users(id),
  sequence integer not null,
  token_hash text not null unique,
  status text not null default 'issued',
  issued_at timestamptz not null,
  checked_in_at timestamptz,
  checked_in_by_admin_id uuid references public.admin_accounts(id),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint tickets_number_check check (ticket_number ~ '^[A-Z0-9-]{6,60}$'),
  constraint tickets_sequence_check check (sequence > 0),
  constraint tickets_token_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint tickets_status_check check (
    status in ('issued', 'checked_in', 'revoked', 'refunded')
  ),
  constraint tickets_lifecycle_check check (
    (status = 'issued' and checked_in_at is null and revoked_at is null)
    or (status = 'checked_in' and checked_in_at is not null and revoked_at is null)
    or (status in ('revoked', 'refunded') and revoked_at is not null)
  ),
  unique (order_item_id, sequence)
);

create index tickets_owner_event_idx
  on public.tickets (owner_user_id, event_id, issued_at desc);

create function public.protect_offer_version_content()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'offer_versions are immutable and cannot be deleted';
  end if;

  if (to_jsonb(new) - 'is_active') is distinct from (to_jsonb(old) - 'is_active') then
    raise exception 'published offer version content is immutable';
  end if;

  return new;
end;
$$;

create trigger offer_versions_protect_content
before update or delete on public.offer_versions
for each row execute function public.protect_offer_version_content();

create function public.prevent_event_sales_record_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name;
end;
$$;

create trigger order_status_history_prevent_update
before update on public.order_status_history
for each row execute function public.prevent_event_sales_record_mutation();

create trigger order_status_history_prevent_delete
before delete on public.order_status_history
for each row execute function public.prevent_event_sales_record_mutation();

create trigger offer_acceptances_prevent_update
before update on public.offer_acceptances
for each row execute function public.prevent_event_sales_record_mutation();

create trigger offer_acceptances_prevent_delete
before delete on public.offer_acceptances
for each row execute function public.prevent_event_sales_record_mutation();

create function public.protect_order_item_composition()
returns trigger
language plpgsql
as $$
declare
  current_order_id uuid;
  current_status text;
  current_offer_accepted_at timestamptz;
begin
  current_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;

  select status, offer_accepted_at
    into current_status, current_offer_accepted_at
    from public.orders
   where id = current_order_id;

  if current_status not in ('draft', 'awaiting_offer') or current_offer_accepted_at is not null then
    raise exception 'order composition is immutable after offer acceptance';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger order_items_protect_composition
before insert or update or delete on public.order_items
for each row execute function public.protect_order_item_composition();

create function public.enforce_order_state_and_snapshot()
returns trigger
language plpgsql
as $$
declare
  transition_allowed boolean;
begin
  if new.status <> old.status then
    transition_allowed := case old.status
      when 'draft' then new.status in ('awaiting_offer', 'cancelled', 'expired')
      when 'awaiting_offer' then new.status in ('awaiting_payment', 'cancelled', 'expired')
      when 'awaiting_payment' then new.status in (
        'payment_processing', 'paid', 'cancelled', 'expired'
      )
      when 'payment_processing' then new.status in (
        'awaiting_payment', 'paid', 'cancelled', 'expired'
      )
      when 'paid' then new.status in ('partially_refunded', 'refunded')
      when 'partially_refunded' then new.status = 'refunded'
      else false
    end;

    if not transition_allowed then
      raise exception 'invalid order transition from % to %', old.status, new.status;
    end if;
  end if;

  if new.offer_accepted_at is not null and (
    new.user_id,
    new.event_id,
    new.currency,
    new.subtotal_kopecks,
    new.discount_kopecks,
    new.total_kopecks,
    new.wallet_applied_kopecks,
    new.external_due_kopecks,
    new.tax_kopecks,
    new.snapshot_schema_version,
    new.event_snapshot,
    new.pricing_snapshot,
    new.offer_version_id,
    new.expires_at
  ) is distinct from (
    old.user_id,
    old.event_id,
    old.currency,
    old.subtotal_kopecks,
    old.discount_kopecks,
    old.total_kopecks,
    old.wallet_applied_kopecks,
    old.external_due_kopecks,
    old.tax_kopecks,
    old.snapshot_schema_version,
    old.event_snapshot,
    old.pricing_snapshot,
    old.offer_version_id,
    old.expires_at
  ) then
    raise exception 'accepted order snapshot is immutable';
  end if;

  if old.offer_accepted_at is not null and new.offer_accepted_at is distinct from old.offer_accepted_at then
    raise exception 'offer acceptance timestamp is immutable';
  end if;

  return new;
end;
$$;

create trigger orders_enforce_state_and_snapshot
before update on public.orders
for each row execute function public.enforce_order_state_and_snapshot();

insert into public.admin_permissions (code, description) values
  ('events.read', 'Read events, content, offers, products, and prices'),
  ('events.write', 'Create and edit draft event sales content'),
  ('events.publish', 'Publish events and immutable offer versions'),
  ('orders.create', 'Create orders and inventory reservations')
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_code, permission_code) values
  ('content_manager', 'events.read'),
  ('content_manager', 'events.write'),
  ('content_manager', 'events.publish'),
  ('sales_manager', 'events.read'),
  ('sales_manager', 'orders.create'),
  ('financial_admin', 'events.read'),
  ('super_admin', 'events.read'),
  ('super_admin', 'events.write'),
  ('super_admin', 'events.publish'),
  ('super_admin', 'orders.create')
on conflict (role_code, permission_code) do nothing;
