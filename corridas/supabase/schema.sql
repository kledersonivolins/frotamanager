-- =====================================================================
-- Corridas — app cliente x motorista
-- Schema completo para Supabase (Postgres 15+).
--
-- Rode UMA VEZ, inteiro, no SQL Editor de um projeto Supabase NOVO
-- (não use o projeto do FrotaManager: os nomes de tabela podem colidir).
--
-- Regras de segurança:
--   * Toda escrita passa por funções (RPC). As tabelas não têm políticas
--     de INSERT/UPDATE/DELETE, então o navegador não grava nada direto.
--   * Cliente e motorista só enxergam a localização um do outro enquanto
--     a corrida está aceita / motorista chegou / em andamento.
--   * A posição "online" do motorista (usada para achar corridas) nunca
--     é exposta a clientes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Utilitários
-- ---------------------------------------------------------------------

-- Distância em km entre dois pontos (fórmula de haversine).
create or replace function public.distancia_km(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable
as $$
  select 2 * 6371 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null,
  telefone   text,
  papel      text not null default 'cliente'
             check (papel in ('cliente', 'motorista', 'admin')),
  criado_em  timestamptz not null default now()
);

create table public.motoristas (
  id              uuid primary key references public.perfis(id) on delete cascade,
  cnh             text,
  veiculo_modelo  text,
  veiculo_cor     text,
  veiculo_placa   text,
  status          text not null default 'pendente'
                  check (status in ('pendente', 'aprovado', 'bloqueado')),
  online          boolean not null default false,
  criado_em       timestamptz not null default now()
);

-- Última posição do motorista enquanto está online (para achar corridas
-- próximas). Só o próprio motorista lê; clientes nunca veem.
create table public.motoristas_posicao (
  motorista_id   uuid primary key references public.motoristas(id) on delete cascade,
  lat            double precision not null,
  lng            double precision not null,
  atualizado_em  timestamptz not null default now()
);

-- Tarifa única (linha id = 1). Edite os valores pelo Table Editor.
create table public.tarifa (
  id             int primary key default 1 check (id = 1),
  bandeirada     numeric(10,2) not null default 5.00,  -- valor fixo de partida
  por_km         numeric(10,2) not null default 2.50,  -- valor por km
  minimo         numeric(10,2) not null default 10.00, -- preço mínimo
  fator_rota     numeric(4,2)  not null default 1.30,  -- linha reta -> ruas
  raio_busca_km  numeric(6,2)  not null default 5.00,  -- raio para ofertar
  expira_min     int           not null default 10     -- minutos sem aceite
);
insert into public.tarifa default values;

create table public.corridas (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references public.perfis(id),
  motorista_id      uuid references public.motoristas(id),
  origem_lat        double precision not null,
  origem_lng        double precision not null,
  origem_endereco   text,
  destino_lat       double precision not null,
  destino_lng       double precision not null,
  destino_endereco  text,
  distancia_km      numeric(8,2) not null,
  preco             numeric(10,2) not null,
  status            text not null default 'solicitada'
                    check (status in ('solicitada', 'aceita', 'chegou',
                                      'em_andamento', 'concluida', 'cancelada')),
  cancelada_por     text check (cancelada_por in ('cliente', 'motorista', 'sistema')),
  criado_em         timestamptz not null default now(),
  solicitada_em     timestamptz not null default now(), -- reinicia se o motorista desistir
  aceita_em         timestamptz,
  chegou_em         timestamptz,
  iniciada_em       timestamptz,
  concluida_em      timestamptz,
  cancelada_em      timestamptz
);

-- Um cliente/motorista só pode ter uma corrida ativa por vez.
create unique index corridas_cliente_ativa on public.corridas (cliente_id)
  where status in ('solicitada', 'aceita', 'chegou', 'em_andamento');
create unique index corridas_motorista_ativa on public.corridas (motorista_id)
  where status in ('aceita', 'chegou', 'em_andamento');
create index corridas_status_idx on public.corridas (status, solicitada_em);

-- Posição compartilhada durante a corrida (uma linha por participante).
create table public.posicoes (
  corrida_id     uuid not null references public.corridas(id) on delete cascade,
  usuario_id     uuid not null references public.perfis(id) on delete cascade,
  papel          text not null check (papel in ('cliente', 'motorista')),
  lat            double precision not null,
  lng            double precision not null,
  precisao       double precision,
  atualizado_em  timestamptz not null default now(),
  primary key (corrida_id, usuario_id)
);

create table public.avaliacoes (
  corrida_id    uuid not null references public.corridas(id) on delete cascade,
  avaliador_id  uuid not null references public.perfis(id) on delete cascade,
  avaliado_id   uuid not null references public.perfis(id) on delete cascade,
  nota          int not null check (nota between 1 and 5),
  comentario    text,
  criado_em     timestamptz not null default now(),
  primary key (corrida_id, avaliador_id)
);
create index avaliacoes_avaliado_idx on public.avaliacoes (avaliado_id);

-- ---------------------------------------------------------------------
-- Cadastro: cria perfil (e motorista) quando alguém se registra
-- ---------------------------------------------------------------------

create or replace function public.criar_perfil()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_papel text := coalesce(m->>'papel', 'cliente');
begin
  -- admin nunca vem do cadastro; é definido manualmente (ver LEIA-ME).
  if v_papel not in ('cliente', 'motorista') then
    v_papel := 'cliente';
  end if;

  insert into perfis (id, nome, telefone, papel)
  values (
    new.id,
    coalesce(nullif(trim(m->>'nome'), ''), split_part(new.email, '@', 1)),
    nullif(trim(m->>'telefone'), ''),
    v_papel
  );

  if v_papel = 'motorista' then
    insert into motoristas (id, cnh, veiculo_modelo, veiculo_cor, veiculo_placa)
    values (
      new.id,
      nullif(trim(m->>'cnh'), ''),
      nullif(trim(m->>'veiculo_modelo'), ''),
      nullif(trim(m->>'veiculo_cor'), ''),
      upper(nullif(trim(m->>'veiculo_placa'), ''))
    );
  end if;

  return new;
end;
$$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- ---------------------------------------------------------------------
-- Funções auxiliares de permissão
-- ---------------------------------------------------------------------

create or replace function public.eh_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from perfis where id = auth.uid() and papel = 'admin');
$$;

-- Cancela pedidos que ninguém aceitou dentro do prazo.
create or replace function public.expirar_corridas()
returns void
language sql security definer set search_path = public
as $$
  update corridas c
     set status = 'cancelada', cancelada_por = 'sistema', cancelada_em = now()
    from tarifa t
   where t.id = 1
     and c.status = 'solicitada'
     and c.solicitada_em < now() - make_interval(mins => t.expira_min);
$$;

-- ---------------------------------------------------------------------
-- Row Level Security (somente leitura; escrita é via funções)
-- ---------------------------------------------------------------------

alter table public.perfis              enable row level security;
alter table public.motoristas          enable row level security;
alter table public.motoristas_posicao  enable row level security;
alter table public.tarifa              enable row level security;
alter table public.corridas            enable row level security;
alter table public.posicoes            enable row level security;
alter table public.avaliacoes          enable row level security;

-- Perfil: o próprio, a outra parte de uma corrida em comum, ou admin.
create policy perfis_select on public.perfis
  for select to authenticated
  using (
    id = auth.uid()
    or public.eh_admin()
    or exists (
      select 1 from public.corridas c
       where (c.cliente_id = auth.uid() and c.motorista_id = perfis.id)
          or (c.motorista_id = auth.uid() and c.cliente_id = perfis.id)
    )
  );

-- Motorista: o próprio, o cliente que corre/correu com ele, ou admin.
-- (A coluna cnh fica bloqueada por GRANT mais abaixo.)
create policy motoristas_select on public.motoristas
  for select to authenticated
  using (
    id = auth.uid()
    or public.eh_admin()
    or exists (
      select 1 from public.corridas c
       where c.cliente_id = auth.uid() and c.motorista_id = motoristas.id
    )
  );

create policy motoristas_posicao_select on public.motoristas_posicao
  for select to authenticated
  using (motorista_id = auth.uid());

create policy tarifa_select on public.tarifa
  for select to authenticated
  using (true);

create policy corridas_select on public.corridas
  for select to authenticated
  using (cliente_id = auth.uid() or motorista_id = auth.uid() or public.eh_admin());

-- Localização da outra parte: só durante a corrida ativa.
create policy posicoes_select on public.posicoes
  for select to authenticated
  using (
    exists (
      select 1 from public.corridas c
       where c.id = posicoes.corrida_id
         and c.status in ('aceita', 'chegou', 'em_andamento')
         and auth.uid() in (c.cliente_id, c.motorista_id)
    )
  );

create policy avaliacoes_select on public.avaliacoes
  for select to authenticated
  using (avaliador_id = auth.uid() or avaliado_id = auth.uid() or public.eh_admin());

-- ---------------------------------------------------------------------
-- Funções chamadas pelo app (RPC)
-- ---------------------------------------------------------------------

-- Preço calculado sempre no servidor.
create or replace function public.estimar_preco(
  o_lat double precision, o_lng double precision,
  d_lat double precision, d_lng double precision
) returns table (km numeric, valor numeric)
language sql stable security definer set search_path = public
as $$
  select round((distancia_km(o_lat, o_lng, d_lat, d_lng) * t.fator_rota)::numeric, 2),
         greatest(
           t.minimo,
           round(t.bandeirada + t.por_km * (distancia_km(o_lat, o_lng, d_lat, d_lng) * t.fator_rota)::numeric, 2)
         )
    from tarifa t
   where t.id = 1;
$$;

create or replace function public.solicitar_corrida(
  o_lat double precision, o_lng double precision, o_endereco text,
  d_lat double precision, d_lng double precision, d_endereco text
) returns public.corridas
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_est record;
  v_corrida corridas;
begin
  if v_uid is null then
    raise exception 'Faça login novamente.';
  end if;
  if not exists (select 1 from perfis p where p.id = v_uid and p.papel = 'cliente') then
    raise exception 'Apenas clientes podem pedir corridas.';
  end if;
  if o_lat is null or o_lng is null or d_lat is null or d_lng is null
     or abs(o_lat) > 90 or abs(d_lat) > 90 or abs(o_lng) > 180 or abs(d_lng) > 180 then
    raise exception 'Origem ou destino inválido.';
  end if;

  perform expirar_corridas();

  select * into v_est from estimar_preco(o_lat, o_lng, d_lat, d_lng);
  if v_est.km < 0.3 then
    raise exception 'Origem e destino estão muito próximos.';
  end if;
  if v_est.km > 300 then
    raise exception 'Distância acima do limite permitido.';
  end if;

  insert into corridas (cliente_id, origem_lat, origem_lng, origem_endereco,
                        destino_lat, destino_lng, destino_endereco,
                        distancia_km, preco)
  values (v_uid, o_lat, o_lng, left(o_endereco, 300),
          d_lat, d_lng, left(d_endereco, 300),
          v_est.km, v_est.valor)
  returning * into v_corrida;

  return v_corrida;
exception
  when unique_violation then
    raise exception 'Você já tem uma corrida em andamento.';
end;
$$;

-- Motorista fica online/offline.
create or replace function public.definir_online(p_online boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  select m.status into v_status from motoristas m where m.id = v_uid;
  if not found then
    raise exception 'Esta conta não é de motorista.';
  end if;
  if p_online and v_status <> 'aprovado' then
    raise exception 'Seu cadastro ainda não foi aprovado.';
  end if;

  update motoristas set online = p_online where id = v_uid;
  if not p_online then
    delete from motoristas_posicao where motorista_id = v_uid;
  end if;
end;
$$;

-- Chamada pelos dois apps a cada poucos segundos com o GPS do aparelho.
--  * Motorista online: guarda a posição para receber corridas próximas.
--  * Corrida ativa: compartilha a posição com a outra parte.
create or replace function public.enviar_posicao(
  p_lat double precision, p_lng double precision, p_precisao double precision default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_corrida corridas;
begin
  if v_uid is null then
    raise exception 'Faça login novamente.';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'Posição inválida.';
  end if;

  if exists (select 1 from motoristas m
              where m.id = v_uid and m.online and m.status = 'aprovado') then
    insert into motoristas_posicao (motorista_id, lat, lng, atualizado_em)
    values (v_uid, p_lat, p_lng, now())
    on conflict (motorista_id) do update
      set lat = excluded.lat, lng = excluded.lng, atualizado_em = now();
  end if;

  select * into v_corrida
    from corridas c
   where c.status in ('aceita', 'chegou', 'em_andamento')
     and v_uid in (c.cliente_id, c.motorista_id)
   limit 1;

  if found then
    insert into posicoes (corrida_id, usuario_id, papel, lat, lng, precisao, atualizado_em)
    values (v_corrida.id, v_uid,
            case when v_corrida.motorista_id = v_uid then 'motorista' else 'cliente' end,
            p_lat, p_lng, p_precisao, now())
    on conflict (corrida_id, usuario_id) do update
      set lat = excluded.lat, lng = excluded.lng,
          precisao = excluded.precisao, atualizado_em = now();
  end if;
end;
$$;

-- Corridas esperando motorista, perto do motorista que chama.
create or replace function public.corridas_disponiveis()
returns table (
  id uuid,
  cliente_nome text,
  origem_lat double precision, origem_lng double precision, origem_endereco text,
  destino_lat double precision, destino_lng double precision, destino_endereco text,
  distancia_km numeric,
  preco numeric,
  distancia_ate_origem_km numeric,
  solicitada_em timestamptz
)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_lat double precision;
  v_lng double precision;
  v_raio numeric;
begin
  perform expirar_corridas();

  if not exists (select 1 from motoristas m
                  where m.id = v_uid and m.online and m.status = 'aprovado') then
    return;
  end if;
  if exists (select 1 from corridas c
              where c.motorista_id = v_uid
                and c.status in ('aceita', 'chegou', 'em_andamento')) then
    return;
  end if;

  select mp.lat, mp.lng into v_lat, v_lng
    from motoristas_posicao mp
   where mp.motorista_id = v_uid
     and mp.atualizado_em > now() - interval '2 minutes';
  if not found then
    return;
  end if;

  select t.raio_busca_km into v_raio from tarifa t where t.id = 1;

  return query
    select c.id, p.nome,
           c.origem_lat, c.origem_lng, c.origem_endereco,
           c.destino_lat, c.destino_lng, c.destino_endereco,
           c.distancia_km, c.preco,
           round(distancia_km(v_lat, v_lng, c.origem_lat, c.origem_lng)::numeric, 2) as ate,
           c.solicitada_em
      from corridas c
      join perfis p on p.id = c.cliente_id
     where c.status = 'solicitada'
       and distancia_km(v_lat, v_lng, c.origem_lat, c.origem_lng) <= v_raio
     order by ate
     limit 20;
end;
$$;

-- Aceite: o primeiro motorista que chamar fica com a corrida.
create or replace function public.aceitar_corrida(p_corrida uuid)
returns public.corridas
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_corrida corridas;
begin
  if not exists (select 1 from motoristas m
                  where m.id = v_uid and m.online and m.status = 'aprovado') then
    raise exception 'Fique online para aceitar corridas.';
  end if;

  update corridas
     set motorista_id = v_uid, status = 'aceita', aceita_em = now()
   where id = p_corrida and status = 'solicitada'
  returning * into v_corrida;

  if not found then
    raise exception 'Esta corrida não está mais disponível.';
  end if;
  return v_corrida;
exception
  when unique_violation then
    raise exception 'Você já está em uma corrida.';
end;
$$;

-- Avança ou cancela a corrida.
--   motorista: 'chegou' -> 'iniciar' -> 'finalizar'
--   cliente ou motorista: 'cancelar' (antes de iniciar)
-- Se o MOTORISTA desiste, a corrida volta para a fila de outros motoristas.
create or replace function public.atualizar_corrida(p_corrida uuid, p_acao text)
returns public.corridas
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_corrida corridas;
  v_motorista boolean;
  v_cliente boolean;
begin
  select * into v_corrida from corridas where id = p_corrida for update;
  if not found then
    raise exception 'Corrida não encontrada.';
  end if;

  v_motorista := coalesce(v_corrida.motorista_id = v_uid, false);
  v_cliente   := coalesce(v_corrida.cliente_id = v_uid, false);
  if not (v_motorista or v_cliente) then
    raise exception 'Você não participa desta corrida.';
  end if;

  if p_acao = 'chegou' then
    if not v_motorista or v_corrida.status <> 'aceita' then
      raise exception 'Ação inválida para o status atual.';
    end if;
    update corridas set status = 'chegou', chegou_em = now()
     where id = p_corrida returning * into v_corrida;

  elsif p_acao = 'iniciar' then
    if not v_motorista or v_corrida.status not in ('aceita', 'chegou') then
      raise exception 'Ação inválida para o status atual.';
    end if;
    update corridas set status = 'em_andamento', iniciada_em = now()
     where id = p_corrida returning * into v_corrida;

  elsif p_acao = 'finalizar' then
    if not v_motorista or v_corrida.status <> 'em_andamento' then
      raise exception 'Ação inválida para o status atual.';
    end if;
    update corridas set status = 'concluida', concluida_em = now()
     where id = p_corrida returning * into v_corrida;
    delete from posicoes where corrida_id = p_corrida;

  elsif p_acao = 'cancelar' then
    if v_corrida.status not in ('solicitada', 'aceita', 'chegou') then
      raise exception 'A corrida já começou e não pode mais ser cancelada.';
    end if;
    if v_cliente then
      update corridas
         set status = 'cancelada', cancelada_por = 'cliente', cancelada_em = now()
       where id = p_corrida returning * into v_corrida;
    else
      update corridas
         set status = 'solicitada', motorista_id = null,
             aceita_em = null, chegou_em = null, solicitada_em = now()
       where id = p_corrida returning * into v_corrida;
    end if;
    delete from posicoes where corrida_id = p_corrida;

  else
    raise exception 'Ação desconhecida: %', p_acao;
  end if;

  return v_corrida;
end;
$$;

create or replace function public.avaliar_corrida(p_corrida uuid, p_nota int, p_comentario text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_corrida corridas;
  v_avaliado uuid;
begin
  select * into v_corrida from corridas where id = p_corrida;
  if not found or v_corrida.status <> 'concluida'
     or v_uid not in (v_corrida.cliente_id, v_corrida.motorista_id) then
    raise exception 'Só é possível avaliar corridas concluídas das quais você participou.';
  end if;
  if p_nota not between 1 and 5 then
    raise exception 'A nota deve ser de 1 a 5.';
  end if;

  v_avaliado := case when v_uid = v_corrida.cliente_id
                     then v_corrida.motorista_id else v_corrida.cliente_id end;

  insert into avaliacoes (corrida_id, avaliador_id, avaliado_id, nota, comentario)
  values (p_corrida, v_uid, v_avaliado, p_nota, left(nullif(trim(p_comentario), ''), 500))
  on conflict (corrida_id, avaliador_id) do update
    set nota = excluded.nota, comentario = excluded.comentario;
end;
$$;

create or replace function public.nota_media(p_usuario uuid)
returns table (media numeric, total bigint)
language sql stable security definer set search_path = public
as $$
  select round(avg(a.nota)::numeric, 1), count(*)
    from avaliacoes a
   where a.avaliado_id = p_usuario;
$$;

-- ---------------------------------------------------------------------
-- Funções de administração
-- ---------------------------------------------------------------------

create or replace function public.motoristas_admin()
returns table (
  id uuid, nome text, telefone text, email text, cnh text,
  veiculo_modelo text, veiculo_cor text, veiculo_placa text,
  status text, online boolean, criado_em timestamptz
)
language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
begin
  if not eh_admin() then
    raise exception 'Acesso restrito ao administrador.';
  end if;
  return query
    select m.id, p.nome, p.telefone, u.email::text, m.cnh,
           m.veiculo_modelo, m.veiculo_cor, m.veiculo_placa,
           m.status, m.online, m.criado_em
      from motoristas m
      join perfis p on p.id = m.id
      join auth.users u on u.id = m.id
     order by (m.status = 'pendente') desc, m.criado_em desc;
end;
$$;

create or replace function public.definir_status_motorista(p_motorista uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not eh_admin() then
    raise exception 'Acesso restrito ao administrador.';
  end if;
  if p_status not in ('pendente', 'aprovado', 'bloqueado') then
    raise exception 'Status inválido.';
  end if;

  update motoristas
     set status = p_status,
         online = case when p_status = 'aprovado' then online else false end
   where id = p_motorista;
  if p_status <> 'aprovado' then
    delete from motoristas_posicao where motorista_id = p_motorista;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------

-- Ninguém grava direto nas tabelas; visitante sem login não lê nada.
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;

-- CNH do motorista só aparece para o admin (via motoristas_admin).
revoke select on public.motoristas from authenticated;
grant select (id, veiculo_modelo, veiculo_cor, veiculo_placa, status, online, criado_em)
  on public.motoristas to authenticated;

-- Funções: só usuários logados.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.criar_perfil() from authenticated;
revoke execute on function public.expirar_corridas() from authenticated;

-- ---------------------------------------------------------------------
-- Tempo real: o app escuta mudanças da corrida e das posições.
-- (O Realtime respeita as políticas de RLS acima.)
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table public.corridas, public.posicoes;
