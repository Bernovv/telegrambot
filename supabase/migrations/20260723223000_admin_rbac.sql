create table public.admin_permissions (
  code text primary key,
  description text not null,
  created_at timestamptz not null default now(),
  constraint admin_permissions_code_check check (
    code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
  )
);

create table public.admin_roles (
  code text primary key,
  display_name text not null,
  requires_mfa boolean not null default false,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_roles_code_check check (
    code ~ '^[a-z][a-z0-9_]*$'
  )
);

create table public.admin_role_permissions (
  role_code text not null references public.admin_roles(code),
  permission_code text not null references public.admin_permissions(code),
  created_at timestamptz not null default now(),
  primary key (role_code, permission_code)
);

create table public.admin_accounts (
  id uuid primary key,
  auth_subject text not null unique,
  email_normalized text,
  display_name text,
  status text not null default 'active',
  sessions_revoked_before timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_accounts_auth_subject_check check (
    length(auth_subject) between 1 and 255
  ),
  constraint admin_accounts_email_normalized_check check (
    email_normalized is null
    or (
      email_normalized = lower(email_normalized)
      and length(email_normalized) between 3 and 320
    )
  ),
  constraint admin_accounts_status_check check (
    status in ('active', 'suspended')
  ),
  constraint admin_accounts_version_check check (version > 0)
);

create table public.admin_role_grants (
  id uuid primary key,
  admin_account_id uuid not null references public.admin_accounts(id),
  role_code text not null references public.admin_roles(code),
  granted_by_admin_id uuid references public.admin_accounts(id),
  granted_at timestamptz not null default now(),
  revoked_by_admin_id uuid references public.admin_accounts(id),
  revoked_at timestamptz,
  reason text,
  constraint admin_role_grants_revocation_check check (
    (revoked_at is null and revoked_by_admin_id is null)
    or (revoked_at is not null)
  )
);

create unique index admin_role_grants_active_unique
  on public.admin_role_grants (admin_account_id, role_code)
  where revoked_at is null;

create index admin_role_grants_account_idx
  on public.admin_role_grants (admin_account_id, granted_at desc);

alter table public.audit_log
  add column actor_admin_id uuid references public.admin_accounts(id);

create index audit_log_actor_admin_idx
  on public.audit_log (actor_admin_id, created_at desc)
  where actor_admin_id is not null;

insert into public.admin_permissions (code, description) values
  ('users.read', 'Read user records'),
  ('users.write', 'Change user records'),
  ('contacts.export', 'Export contact data'),
  ('orders.read', 'Read orders'),
  ('orders.manual_paid', 'Mark an order paid manually'),
  ('payments.read', 'Read payments'),
  ('payments.refund', 'Create payment refunds'),
  ('wallet.adjust', 'Create wallet adjustments'),
  ('referrals.manage', 'Manage referral settings'),
  ('broadcasts.send', 'Test, schedule, pause, and send broadcasts'),
  ('scenarios.publish', 'Publish scenario versions'),
  ('imports.execute', 'Execute data imports'),
  ('system.read', 'Read system operations state'),
  ('system.manage', 'Manage jobs and system operations'),
  ('admins.manage', 'Manage administrators and role grants')
on conflict (code) do nothing;

insert into public.admin_roles (code, display_name, requires_mfa) values
  ('content_manager', 'Content manager', false),
  ('sales_manager', 'Sales manager', false),
  ('financial_admin', 'Financial administrator', true),
  ('technical_admin', 'Technical administrator', false),
  ('super_admin', 'Super administrator', true)
on conflict (code) do nothing;

insert into public.admin_role_permissions (role_code, permission_code) values
  ('content_manager', 'users.read'),
  ('content_manager', 'orders.read'),
  ('content_manager', 'broadcasts.send'),
  ('content_manager', 'scenarios.publish'),
  ('sales_manager', 'users.read'),
  ('sales_manager', 'users.write'),
  ('sales_manager', 'orders.read'),
  ('sales_manager', 'orders.manual_paid'),
  ('financial_admin', 'users.read'),
  ('financial_admin', 'contacts.export'),
  ('financial_admin', 'orders.read'),
  ('financial_admin', 'payments.read'),
  ('financial_admin', 'payments.refund'),
  ('financial_admin', 'wallet.adjust'),
  ('financial_admin', 'referrals.manage'),
  ('technical_admin', 'imports.execute'),
  ('technical_admin', 'system.read'),
  ('technical_admin', 'system.manage'),
  ('super_admin', 'users.read'),
  ('super_admin', 'users.write'),
  ('super_admin', 'contacts.export'),
  ('super_admin', 'orders.read'),
  ('super_admin', 'orders.manual_paid'),
  ('super_admin', 'payments.read'),
  ('super_admin', 'payments.refund'),
  ('super_admin', 'wallet.adjust'),
  ('super_admin', 'referrals.manage'),
  ('super_admin', 'broadcasts.send'),
  ('super_admin', 'scenarios.publish'),
  ('super_admin', 'imports.execute'),
  ('super_admin', 'system.read'),
  ('super_admin', 'system.manage'),
  ('super_admin', 'admins.manage')
on conflict (role_code, permission_code) do nothing;

create function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_prevent_update
before update on public.audit_log
for each row execute function public.prevent_audit_log_mutation();

create trigger audit_log_prevent_delete
before delete on public.audit_log
for each row execute function public.prevent_audit_log_mutation();
