alter table public.broadcast_versions
  drop constraint broadcast_versions_schema_check;

alter table public.broadcast_versions
  add constraint broadcast_versions_schema_check check (
    schema_version in (1, 2, 3)
  );

alter table public.broadcast_test_deliveries
  drop constraint broadcast_test_deliveries_schema_check;

alter table public.broadcast_test_deliveries
  add constraint broadcast_test_deliveries_schema_check check (
    schema_version in (1, 2, 3)
  );
