-- FrotaManager — Módulo Troca de Óleo / Filtros
-- Rodar no SQL Editor do Supabase (projeto gocdyfhzqezpqyebixid). Pode ser executado mais de uma vez.

-- Itens e intervalos de troca (cadastro único por tenant)
create table if not exists troca_oleo_config (
  id                bigint primary key,
  tenant            text not null,
  nome              text not null,
  categoria         text default 'oleo',          -- oleo | filtro | outro
  intervalo_hod     numeric,                      -- troca a cada X km ou horas
  intervalo_dias    integer,                      -- troca a cada X dias
  quantidade_padrao numeric,
  unidade           text default 'un',
  ordem             integer default 0,
  ativo             boolean default true,
  criado_em         timestamptz default now()
);

-- Referências gravadas por veículo + última troca de cada item
create table if not exists troca_oleo_veiculo (
  id                bigint primary key,
  tenant            text not null,
  equipamento_id    bigint not null,
  config_id         bigint not null,
  referencia        text,
  quantidade        numeric,
  unidade           text,
  ultima_troca_data date,
  ultimo_hod        numeric,
  ultima_os_id      bigint,
  ultima_os_numero  text,
  ativo             boolean default true,
  atualizado_em     timestamptz default now()
);

create index if not exists idx_troca_oleo_config_tenant  on troca_oleo_config(tenant);
create index if not exists idx_troca_oleo_veiculo_tenant on troca_oleo_veiculo(tenant, equipamento_id);
create unique index if not exists uq_troca_oleo_veiculo_item on troca_oleo_veiculo(tenant, equipamento_id, config_id) where ativo;

-- RLS: copie aqui a MESMA política que você usa em ordens_servico / equipamentos.
-- O padrão abaixo libera para usuários autenticados; ajuste se o sistema usa a chave anon.
alter table troca_oleo_config  enable row level security;
alter table troca_oleo_veiculo enable row level security;

drop policy if exists troca_oleo_config_all  on troca_oleo_config;
drop policy if exists troca_oleo_veiculo_all on troca_oleo_veiculo;
create policy troca_oleo_config_all  on troca_oleo_config  for all to authenticated using (true) with check (true);
create policy troca_oleo_veiculo_all on troca_oleo_veiculo for all to authenticated using (true) with check (true);
